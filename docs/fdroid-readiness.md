# GymTrack F-Droid Readiness

Checked against F-Droid guidance on 2026-07-17.

## Done In Code

- App is licensed as ISC in `LICENSE` and `package.json`.
- App id is `com.gymtrack.app`.
- Internet permission is removed.
- Google services/Firebase Gradle plugin wiring is removed.
- Android backup is disabled.
- Packaged sample CSV is removed from release assets.
- Fastlane/F-Droid listing metadata is in `fastlane/metadata/android/en-US/`.
- Release APK script added: `npm run android:release`.
- F-Droid preparation script added: `npm run fdroid:prepare`.
- Root `.gitignore` excludes generated assets, build outputs, local SDK/JDK, and `node_modules`.
- Local generated folders and the old personal CSV export are not required and should stay out of git.
- F-Droid/fastlane screenshots live in `fastlane/metadata/android/en-US/images/phoneScreenshots/`.
- GitHub source URL is `https://github.com/solasmeryl/gymTrack`.

## Expected F-Droid Metadata

Use this as a starting point in `fdroiddata/metadata/com.gymtrack.app.yml`:

```yaml
Categories:
  - Sports & Health
License: ISC
AuthorName: solasmeryl
WebSite: https://github.com/solasmeryl/gymTrack
SourceCode: https://github.com/solasmeryl/gymTrack
IssueTracker: https://github.com/solasmeryl/gymTrack/issues
Changelog: https://github.com/solasmeryl/gymTrack/releases

AutoName: GymTrack

RepoType: git
Repo: https://github.com/solasmeryl/gymTrack.git

Builds:
  - versionName: '1.0'
    versionCode: 1
    subdir: android
    sudo:
      - apt-get update
      - apt-get install -y nodejs npm
    init:
      - cd .. && npm ci
      - cd .. && npm run build
      - cd .. && npx cap sync android
    gradle:
      - yes

AutoUpdateMode: Version
UpdateCheckMode: Tags
CurrentVersion: '1.0'
CurrentVersionCode: 1
```

The same ready-to-copy metadata is also stored in `fdroid/metadata/com.gymtrack.app.yml`.

## Submission Notes

- F-Droid builds APKs from source, not Android App Bundles.
- Tag the source release that matches `versionName` and `versionCode`.
- Do not commit `node_modules`, local Android SDK/JDK folders, generated `www`, or Android build outputs.
- Keep dependency changes easy to audit by committing `package-lock.json`.
- If reviewers flag npm dependency fetching, move the app to a source-only web build step approved in the fdroiddata merge request.
