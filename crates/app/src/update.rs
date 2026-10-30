//! The updater, kept by the app rather than by each window (ADR 0044).
//!
//! ADR 0017 put the check, the download and the relaunch in the webview,
//! and every window has a webview of its own. Two windows meant two
//! checks, two status bars that disagreed once one of them had started a
//! download, and a relaunch that wrote down what one window held and
//! dropped what the others did. So the update is the app's, as the agent
//! server is: one state here, every change sent to every window, and the
//! windows only ask and show.
//!
//! What the windows are told is a [`UpdateState`]; what goes wrong is an
//! [`UpdateFailure`], a kind rather than a sentence. The sentences are the
//! window's to write, beside every other sentence the app says, and the
//! kind is decided here because only here is the plugin's error still a
//! type and not a string.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, MutexGuard, PoisonError};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use tauri_plugin_updater::{Error as PluginError, Update, UpdaterExt};
use tauri_specta::Event;

/// The first automatic check waits this long after launch, so it is never
/// in the way of the windows coming up.
const FIRST_LOOK: Duration = Duration::from_secs(10);

/// How long after one answered check the next automatic one is due. A day
/// is what a reader expects of a desktop app, and launching ten times in
/// an afternoon asks once.
pub const CHECK_EVERY: Duration = Duration::from_hours(24);

/// How often a running app wakes to see whether a check is due. Waking
/// asks nothing; it reads a time. An app left open overnight checks once
/// in the morning rather than at whatever hour it happened to start.
const WAKE_EVERY: Duration = Duration::from_hours(1);

/// Where the time of the last answered check is kept, in the app's data
/// directory. Its own file, because it is not a setting: nothing in the
/// app shows it and nobody would want to change it.
const RECORD: &str = "update-check.json";

/// A release the endpoint offered, as much of it as a window shows.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
pub struct Release {
    pub version: String,
    /// The release notes, as markdown. Empty when the manifest has none.
    pub notes: String,
}

/// Where the update stands, the same in every window.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, specta::Type)]
#[serde(tag = "phase", rename_all = "snake_case")]
pub enum UpdateState {
    /// Nothing to offer: not checked yet, or checked and up to date.
    Idle,
    Available {
        release: Release,
    },
    Downloading {
        release: Release,
        /// From 0 to 1, or absent while the server has not said how big
        /// the download is.
        fraction: Option<f64>,
    },
    /// Downloaded and verified. On macOS and Linux it is also in place,
    /// so the next launch is the new version whichever way it comes; on
    /// Windows the installer runs on the restart.
    Ready {
        release: Release,
    },
}

/// Why a check or a download did not go through.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum UpdateFailure {
    /// A build run by `tauri dev`, which has no bundle to replace.
    NotInstalled,
    /// The endpoint could not be reached at all.
    Offline,
    /// The endpoint answered, but not with a release: an error status, a
    /// manifest that does not parse, a download that is not there.
    NoRelease,
    /// The release has nothing built for this computer.
    NoBuild,
    /// The download does not carry the signature of the key this build
    /// trusts. Nothing was installed.
    Unverified,
    /// The system asked for a password to replace the app, and was not
    /// given one.
    Cancelled,
    /// Anything else, in the plugin's words.
    Other { message: String },
}

/// The update changed. Sent to every window, because it is the app's.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, Event)]
pub struct UpdateEvent(pub UpdateState);

/// The app's one updater.
pub struct Updates {
    state: Mutex<UpdateState>,
    /// What the last check found, kept for the download: the plugin
    /// downloads from the `Update` it handed back, not from a version.
    found: Mutex<Option<Update>>,
    /// The verified download, held for the restart. Only Windows needs
    /// it held: its installer ends the process, so it runs after every
    /// window has written down what it holds.
    #[cfg(windows)]
    bytes: Mutex<Option<Vec<u8>>>,
    /// Set by the restart, read when the process is ending.
    restarting: AtomicBool,
    /// One check at a time. A second waits for the first and then asks
    /// again, which is cheaper than working out whether its answer would
    /// have been the same.
    checking: tauri::async_runtime::Mutex<()>,
}

impl Default for Updates {
    fn default() -> Self {
        Self {
            state: Mutex::new(UpdateState::Idle),
            found: Mutex::new(None),
            #[cfg(windows)]
            bytes: Mutex::new(None),
            restarting: AtomicBool::new(false),
            checking: tauri::async_runtime::Mutex::new(()),
        }
    }
}

fn lock<T>(what: &Mutex<T>) -> MutexGuard<'_, T> {
    what.lock().unwrap_or_else(PoisonError::into_inner)
}

fn set(app: &AppHandle, updates: &Updates, state: UpdateState) {
    *lock(&updates.state) = state.clone();
    if let Err(error) = UpdateEvent(state).emit(app) {
        eprintln!("could not report the update: {error}");
    }
}

/// What the plugin's error comes to, as far as the reader is concerned.
#[must_use]
pub fn failure(error: &PluginError) -> UpdateFailure {
    match error {
        // A status is an answer; everything else `reqwest` reports is
        // not having got one — no network, no DNS, a refused connection,
        // a timeout, or a connection that dropped mid-download.
        PluginError::Reqwest(error) if error.is_status() => UpdateFailure::NoRelease,
        PluginError::Reqwest(_) => UpdateFailure::Offline,
        PluginError::ReleaseNotFound | PluginError::Network(_) | PluginError::Serialization(_) => {
            UpdateFailure::NoRelease
        }
        PluginError::TargetNotFound(_) | PluginError::TargetsNotFound(_) => UpdateFailure::NoBuild,
        PluginError::Minisign(_) | PluginError::Base64(_) | PluginError::SignatureUtf8(_) => {
            UpdateFailure::Unverified
        }
        PluginError::AuthenticationFailed => UpdateFailure::Cancelled,
        other => UpdateFailure::Other {
            message: other
                .to_string()
                .lines()
                .next()
                .unwrap_or_default()
                .to_owned(),
        },
    }
}

fn release_of(update: &Update) -> Release {
    Release {
        version: update.version.clone(),
        notes: update.body.clone().unwrap_or_default().trim().to_owned(),
    }
}

/// Whether an automatic check is due, given when the last one was
/// answered. A last check in the future means the clock was moved, and
/// is not a reason to wait a day from a time that has not happened.
#[must_use]
pub fn due(last: Option<SystemTime>, now: SystemTime) -> bool {
    last.is_none_or(|last| {
        !now.duration_since(last)
            .is_ok_and(|gone| gone < CHECK_EVERY)
    })
}

#[derive(Serialize, Deserialize)]
struct Record {
    /// Seconds since the epoch.
    checked: u64,
}

/// When the last answered check was, or `None` if it is not known.
#[must_use]
pub fn last_checked(dir: &Path) -> Option<SystemTime> {
    let text = std::fs::read_to_string(dir.join(RECORD)).ok()?;
    let record: Record = serde_json::from_str(&text).ok()?;
    UNIX_EPOCH.checked_add(Duration::from_secs(record.checked))
}

/// Write down that a check was answered at `when`.
///
/// # Errors
/// Fails when the directory cannot be made or the file written.
pub fn record_check(dir: &Path, when: SystemTime) -> std::io::Result<()> {
    let checked = when
        .duration_since(UNIX_EPOCH)
        .map_or(0, |since| since.as_secs());
    std::fs::create_dir_all(dir)?;
    std::fs::write(
        dir.join(RECORD),
        serde_json::to_string(&Record { checked })?,
    )
}

fn data_dir(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_data_dir().ok()
}

/// Ask the endpoint whether there is something newer.
///
/// A check while a download is under way or ready to restart asks
/// nothing and answers with where things stand: there is already an
/// update in hand. A check that fails leaves the state as it was, so an
/// update already offered is not taken back because the network went.
async fn check(app: &AppHandle) -> Result<UpdateState, UpdateFailure> {
    if tauri::is_dev() {
        return Err(UpdateFailure::NotInstalled);
    }
    let updates = app.state::<Updates>();
    let _one = updates.checking.lock().await;
    let now = lock(&updates.state).clone();
    if matches!(
        now,
        UpdateState::Downloading { .. } | UpdateState::Ready { .. }
    ) {
        return Ok(now);
    }
    let plugin = app.updater().map_err(|error| failure(&error))?;
    let found = plugin.check().await.map_err(|error| failure(&error))?;
    if let Some(dir) = data_dir(app)
        && let Err(error) = record_check(&dir, SystemTime::now())
    {
        eprintln!("could not record the update check: {error}");
    }
    let state = if let Some(update) = found {
        let release = release_of(&update);
        *lock(&updates.found) = Some(update);
        UpdateState::Available { release }
    } else {
        *lock(&updates.found) = None;
        UpdateState::Idle
    };
    set(app, &updates, state.clone());
    Ok(state)
}

/// Download what the last check found, verify it, and put it in place.
///
/// Asked again while a download is running, or with nothing found, it
/// does nothing: the window that asked is already showing why.
async fn install(app: &AppHandle) -> Result<(), UpdateFailure> {
    let updates = app.state::<Updates>();
    let Some(update) = lock(&updates.found).clone() else {
        return Ok(());
    };
    // Looked at and moved on in one step, so two windows pressing at once
    // start one download between them.
    let release = {
        let mut state = lock(&updates.state);
        let UpdateState::Available { release } = &*state else {
            return Ok(());
        };
        let release = release.clone();
        *state = UpdateState::Downloading {
            release: release.clone(),
            fraction: None,
        };
        release
    };
    set(
        app,
        &updates,
        UpdateState::Downloading {
            release: release.clone(),
            fraction: None,
        },
    );
    let mut received: u64 = 0;
    let mut shown: Option<u64> = None;
    let downloaded = update
        .download(
            |chunk, total| {
                received += u64::try_from(chunk).unwrap_or(u64::MAX);
                let Some(total) = total.filter(|total| *total > 0) else {
                    return;
                };
                // A percent at a time: a chunk is a few kilobytes, and
                // every event crosses into every window.
                let percent = (received * 100 / total).min(100);
                if shown == Some(percent) {
                    return;
                }
                shown = Some(percent);
                #[allow(clippy::cast_precision_loss)]
                let fraction = Some(percent as f64 / 100.0);
                set(
                    app,
                    &updates,
                    UpdateState::Downloading {
                        release: release.clone(),
                        fraction,
                    },
                );
            },
            || {},
        )
        .await;
    let back = |error: &PluginError| {
        set(
            app,
            &updates,
            UpdateState::Available {
                release: release.clone(),
            },
        );
        failure(error)
    };
    let bytes = downloaded.map_err(|error| back(&error))?;
    put_in_place(&updates, update, bytes)
        .await
        .map_err(|error| back(&error))?;
    set(app, &updates, UpdateState::Ready { release });
    Ok(())
}

/// macOS and Linux: replace the app now. The running process does not
/// read its bundle again, so it carries on as it was until the restart,
/// and a reader who quits instead of restarting gets the new version on
/// the next launch all the same. Off the async runtime, because it
/// unpacks an archive and may wait on a password prompt.
#[cfg(not(windows))]
async fn put_in_place(
    _updates: &Updates,
    update: Update,
    bytes: Vec<u8>,
) -> Result<(), PluginError> {
    tauri::async_runtime::spawn_blocking(move || update.install(bytes))
        .await
        .map_err(|error| PluginError::Io(std::io::Error::other(error.to_string())))?
}

/// Windows: hold it. Its installer ends the process the moment it starts,
/// so it runs from [`finish`], once every window has written down what it
/// holds.
#[cfg(windows)]
async fn put_in_place(
    updates: &Updates,
    _update: Update,
    bytes: Vec<u8>,
) -> Result<(), PluginError> {
    *lock(&updates.bytes) = Some(bytes);
    Ok(())
}

/// Quit, and come back as the new version.
///
/// The quit is the ordinary one — every window is asked to write down what
/// it holds, and the app goes when they have — so a restart loses nothing
/// a quit would keep. Only the end differs, in [`finish`].
fn restart(app: &AppHandle) {
    let updates = app.state::<Updates>();
    if !matches!(*lock(&updates.state), UpdateState::Ready { .. }) {
        return;
    }
    updates.restarting.store(true, Ordering::SeqCst);
    app.exit(0);
}

/// The process is ending. If it is ending for an update, start the new
/// version. Called from `RunEvent::Exit`, after the session is written.
pub fn finish(app: &AppHandle) {
    let Some(updates) = app.try_state::<Updates>() else {
        return;
    };
    if !updates.restarting.load(Ordering::SeqCst) {
        return;
    }
    #[cfg(windows)]
    {
        let found = lock(&updates.found).clone();
        let bytes = lock(&updates.bytes).take();
        if let (Some(update), Some(bytes)) = (found, bytes) {
            // Runs the installer and ends the process; the installer
            // starts the app again when it is done. Back here only if
            // the installer could not be started.
            if let Err(error) = update.install(bytes) {
                eprintln!("could not start the installer: {error}");
            }
        }
    }
    app.restart();
}

/// Check once a day, quietly (ADR 0044). The first look is a moment after
/// launch; after that the app wakes every hour and checks only if a day
/// has gone by since the last check that got an answer. A check that got
/// none — the network was down — is not written down, so the next hour
/// tries again.
pub fn start(app: &AppHandle) {
    if tauri::is_dev() {
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(FIRST_LOOK).await;
        loop {
            let last = data_dir(&app).and_then(|dir| last_checked(&dir));
            if due(last, SystemTime::now()) {
                // Quiet either way: an automatic check that fails, or
                // finds nothing, is not news (ADR 0017).
                let _quiet = check(&app).await;
            }
            tokio::time::sleep(WAKE_EVERY).await;
        }
    });
}

// --- commands ------------------------------------------------------------

/// Where the update stands, for a window that has just opened.
#[tauri::command]
#[specta::specta]
pub(crate) fn update_state(updates: tauri::State<'_, Updates>) -> UpdateState {
    lock(&updates.state).clone()
}

/// Check now, because the reader asked. Answers with where the update
/// stands afterwards, which the window reports either way.
///
/// # Errors
/// Why the check did not get an answer.
#[tauri::command]
#[specta::specta]
pub(crate) async fn check_for_update(app: AppHandle) -> Result<UpdateState, UpdateFailure> {
    check(&app).await
}

/// Download and put in place what the last check found.
///
/// # Errors
/// Why the download or the install did not go through. The update is
/// offered again either way.
#[tauri::command]
#[specta::specta]
pub(crate) async fn install_update(app: AppHandle) -> Result<(), UpdateFailure> {
    install(&app).await
}

/// Quit and come back as the new version, once one is ready.
#[tauri::command]
#[specta::specta]
pub(crate) fn restart_to_update(app: AppHandle) {
    restart(&app);
}

#[cfg(test)]
mod tests {
    use base64::Engine as _;

    use super::*;

    const HOUR: Duration = Duration::from_hours(1);

    fn at(hours: u64) -> SystemTime {
        UNIX_EPOCH + Duration::from_secs(1_790_000_000) + HOUR * u32::try_from(hours).unwrap()
    }

    #[test]
    fn a_check_is_due_once_a_day() {
        assert!(due(None, at(0)), "never checked");
        assert!(!due(Some(at(0)), at(1)));
        assert!(!due(Some(at(0)), at(23)));
        assert!(due(Some(at(0)), at(24)));
        assert!(due(Some(at(0)), at(24 * 9)));
    }

    #[test]
    fn a_check_in_the_future_does_not_hold_the_next_one_back() {
        // The clock was set back after the last check. Waiting until a day
        // after a time that has not come yet could be waiting a year.
        assert!(due(Some(at(48)), at(0)));
    }

    #[test]
    fn the_last_check_survives_a_restart() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(last_checked(dir.path()), None);
        record_check(dir.path(), at(5)).unwrap();
        assert_eq!(last_checked(dir.path()), Some(at(5)));
    }

    #[test]
    fn a_record_that_cannot_be_read_means_a_check_is_due() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join(RECORD), "not json").unwrap();
        assert_eq!(last_checked(dir.path()), None);
        assert!(due(last_checked(dir.path()), at(0)));
    }

    #[test]
    fn a_bad_signature_is_unverified() {
        // The two ways a signature can be wrong that do not need a key to
        // produce: not base64, and base64 of something that is not text.
        let undecodable = base64::engine::general_purpose::STANDARD
            .decode("%%%")
            .unwrap_err();
        assert_eq!(
            failure(&PluginError::Base64(undecodable)),
            UpdateFailure::Unverified
        );
        assert_eq!(
            failure(&PluginError::SignatureUtf8("//79".to_owned())),
            UpdateFailure::Unverified
        );
    }

    #[test]
    fn an_answer_without_a_release_is_said_as_one() {
        assert_eq!(
            failure(&PluginError::ReleaseNotFound),
            UpdateFailure::NoRelease
        );
        assert_eq!(
            failure(&PluginError::Network(
                "Download request failed with status: 404 Not Found".to_owned()
            )),
            UpdateFailure::NoRelease
        );
        assert_eq!(
            failure(&PluginError::TargetNotFound("darwin-aarch64".to_owned())),
            UpdateFailure::NoBuild
        );
        assert_eq!(
            failure(&PluginError::AuthenticationFailed),
            UpdateFailure::Cancelled
        );
    }

    #[test]
    fn anything_else_keeps_the_first_line_of_what_the_plugin_said() {
        let io = PluginError::Io(std::io::Error::other("disk full\nat line 3"));
        assert_eq!(
            failure(&io),
            UpdateFailure::Other {
                message: "disk full".to_owned()
            }
        );
    }
}
