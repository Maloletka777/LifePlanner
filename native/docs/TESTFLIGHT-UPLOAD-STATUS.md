# TestFlight upload preparation — 18 October 2026

## 19 October continuation

The owner reported that Apple Support had cleared the agreement issue and authorised continuing. After renewed sign-in, the agreement warning disappeared and New App opened normally. Created the separate iOS App Store Connect record `6824491469`, name `Live Planner Swift`, bundle `com.olegkotikov.liveplanner.swift.dev`, primary language English (U.K.), SKU `liveplanner-swift-20261018`. TestFlight opens and currently reports No Builds. This supersedes the account blocker recorded below. Delivery and processing must still be verified.

The owner authorised uploading the native candidate to App Store Connect/TestFlight. This is not authorisation for public App Store release, purchases or accepting legal agreements on the owner's behalf.

## Account observations

- The existing Chrome session is signed in to Apple Developer and App Store Connect. Membership is active, with renewal shown in July 2027; no new subscription purchase is needed for the present preparation.
- Existing app `6793826774` is LifePlanner (d2831f), with old Expo TestFlight versions. The visible 1.0.0 build is expired. No Swift build was found or uploaded.
- Apple Developer displayed an updated Program License Agreement blocking certificates and App Store Connect resources. The agreement was opened without accepting it. The owner reported accepting it; subsequent fresh App Store Connect/Xcode Cloud pages still displayed the requirement. After the owner completed the agreement step, a fresh Xcode Cloud page no longer showed the block. Access to certificate creation was restored.
- Xcode Cloud now offers an initial setup screen requiring Xcode. No cloud product or repository authorisation is configured there. With explicit owner approval, an Apple Distribution certificate was issued; its downloaded public key matches the prepared local private key and team. The P12 is encrypted and excluded from Git/review archives. API key and candidate app/profile setup are still in progress.
- No P12, P8 or provisioning profile was found among the supplied project/research workspaces. This does not establish whether Expo/EAS or the owner retains signing materials elsewhere.

## Build preparation

Apple's current upload requirement is Xcode 26 or later with iOS 26 SDK or later. Earlier successful simulator checks used Xcode 16.4 and are not evidence of eligibility for upload. The workflows now explicitly select installed Xcode 26.3 and include an unsigned Release archive for a real iPhone destination before signing setup. In run 39137052992 (source 5881ab7), the package tests, iOS simulator build, macOS build and unsigned iPhone Release archive steps passed; all five UI tests also passed. See apple-release-preflight.txt. This successful unsigned archive is not a signed IPA or an upload.

The original opaque 1024×1024 RGB project icon is copied unchanged into an iOS AppIcon asset catalogue and connected to the target. It remains the old prototype icon, not newly designed artwork. The candidate has no custom/non-exempt encryption implementation; its generated plist declares `ITSAppUsesNonExemptEncryption=NO`. Apple validation remains authoritative.

Candidate bundle ID remains `com.olegkotikov.liveplanner.swift.dev`, separate from the old Expo app. A corresponding identifier, app record and signing profile must exist before uploading this candidate. The existing app is not silently repurposed.

## Completion requirements

1. Verify that Apple has removed the agreement block.
2. Check the Xcode 26.3 package/build/Release archive results at the recorded source commit.
3. Configure the candidate record and signing. Any new persistent credentials/repository access must be explicitly confirmed at setup; no secrets belong in chat or Git.
4. Produce and validate a signed IPA, then upload through App Store Connect's supported delivery mechanism. A saved unsigned archive or an export-only workflow is not an upload.
5. Verify Apple's processing result and build identity in TestFlight, add to the intended internal testing group and install on the owner's iPhone.

Until those observable steps finish, status is **not uploaded**. The manual workflow now has an optional validation/upload step, default off. Its upload helper has only been syntax-checked and checked for refusal without credentials; delivery has not been executed.

## Signing setup progress

- The owner explicitly authorised creating the distribution certificate, a Developer-role App Store Connect API key, and storing signing/upload credentials in this repository's GitHub Secrets for building and TestFlight.
- The candidate App ID and an active App Store provisioning profile named `LivePlanner Swift AppStore 2026-10-18` have been created. The downloaded profile's CMS signature and candidate bundle/team identity were verified locally and it was copied to the restricted signing folder.
- After a separate explicit owner confirmation of the API internal-use terms, those terms were accepted and API access enabled. The `LivePlanner Swift CI` key was generated with Developer access. Its downloaded private key was validated and saved in the restricted local signing folder. No private key contents belong in this report or repository.
- App Store Connect still displayed an agreement-update gate when attempting to create the candidate app record, including after the owner completed a fresh sign-in. The Developer account Agreements section explicitly shows the Program License Agreement issued 13 October and accepted 18 October 2026. These services currently disagree; the app record has not been created. Do not infer that another legal acceptance is needed or that the gate is cleared.
- All seven repository signing/upload secrets were saved and their names verified in GitHub Settings with the owner's explicit authorisation. Their values were not exposed in source or reports.
- Signed export run [39139994490](https://github.com/Maloletka777/LifePlanner/actions/runs/39139994490), source `c31e9b2bea22ab1cea824ec76a39019a41e3a202`, completed successfully on Xcode 26.3. Both archive and export succeeded. The export-only tag intentionally skipped upload. The downloaded artifact matches the runner's SHA256; the IPA identifies bundle `com.olegkotikov.liveplanner.swift.dev`, version 0.1.0, build 1, iPhoneOS 26.2 SDK, and contains the embedded profile and code-signature resources. Its evidence explicitly says uploadedToApple=false. See apple-signed-export-summary.txt.
- Current blocker to delivery is the agreement gate in App Store Connect preventing creation of the separate candidate app record. No signed build has been uploaded or processed in TestFlight. A successful export does not establish Apple upload validation or device acceptance.
- Follow-up diagnosis in Business confirmed `Free Apps Agreement: Active (New Agreement Available)`, while the Developer agreement history shows acceptance on 18 October. No Paid Apps Agreement was offered in that table. Prepared an unsent Apple Developer Support draft under Membership and Account > Agreements and Contracts, requesting reconciliation or identification of the exact outstanding agreement. Sending awaits the owner's explicit permission; no support case is claimed yet.
- The owner then explicitly authorised sending that draft. Apple confirmed submission on 18 October 2026, case ID `103000730952`, and stated that it will review the message and reply. The account blocker is not yet resolved; no response or delivery completion is inferred from case creation.

The signing workflow also supports explicit `testflight-*` tag pushes, which request signing and upload of that tagged revision, and `ios-archive-*` tags, which request export only. This avoids merging the unaccepted migration into the default branch merely to enable workflow_dispatch. Do not create a TestFlight tag before signing credentials and the candidate app record are ready.

Sources checked:

- [Apple upcoming upload requirements](https://developer.apple.com/news/upcoming-requirements/?id=02032026a)
- [Apple upload builds](https://developer.apple.com/help/app-store-connect/manage-builds/upload-builds/)
- [GitHub macOS runner installed Xcode versions](https://github.com/actions/runner-images/blob/main/images/macos/macos-15-Readme.md)
