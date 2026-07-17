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

## Expected F-Droid Metadata

Use this as a starting point in `fdroiddata/metadata/com.gymtrack.app.yml` after the source repository URL exists:

```yaml
Categories:
  - Sports & Health
License: ISC
AuthorName: GymTrack contributors
SourceCode: https://example.invalid/replace-me/gymtrack
IssueTracker: https://example.invalid/replace-me/gymtrack/issues

AutoName: GymTrack

RepoType: git
Repo: https://example.invalid/replace-me/gymtrack.git

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

## Submission Notes

- F-Droid builds APKs from source, not Android App Bundles.
- Tag the source release that matches `versionName` and `versionCode`.
- Do not commit `node_modules`, local Android SDK/JDK folders, generated `www`, or Android build outputs.
- Keep dependency changes easy to audit by committing `package-lock.json`.
- If reviewers flag npm dependency fetching, move the app to a source-only web build step approved in the fdroiddata merge request.
