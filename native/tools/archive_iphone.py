"""Manual signed device export on an ephemeral macOS runner. Never uploads to Apple."""
import base64
import datetime
import json
import os
from pathlib import Path
import plistlib
import secrets
import subprocess
import tempfile


def run(*args, **kwargs):
    return subprocess.run(args, check=True, **kwargs)


def main():
    names = ("IOS_CERTIFICATE_BASE64", "IOS_CERTIFICATE_PASSWORD", "IOS_PROFILE_BASE64", "APPLE_TEAM_ID")
    if any(not os.environ.get(name) for name in names):
        raise SystemExit("Configure the four signing secrets described in docs/IPHONE-WITHOUT-MAC-RU.md first.")
    method = os.environ.get("EXPORT_METHOD", "app-store-connect")
    if method not in ("app-store-connect", "release-testing"):
        raise SystemExit("Unsupported export method")
    root = Path(__file__).resolve().parents[1]
    bundle = "com.olegkotikov.liveplanner.swift.dev"
    team = os.environ["APPLE_TEAM_ID"]
    output = root / "DeviceExport"
    profile_installed = None
    keychain_created = False
    previous_keychains = subprocess.check_output(["security", "list-keychains", "-d", "user"], text=True)
    import shlex
    previous_keychains = shlex.split(previous_keychains)
    with tempfile.TemporaryDirectory(prefix="liveplanner-signing-") as folder:
        temporary = Path(folder)
        certificate = temporary / "certificate.p12"
        profile = temporary / "profile.mobileprovision"
        keychain = temporary / "build.keychain-db"
        certificate.write_bytes(base64.b64decode(os.environ["IOS_CERTIFICATE_BASE64"], validate=True))
        profile.write_bytes(base64.b64decode(os.environ["IOS_PROFILE_BASE64"], validate=True))
        decoded = subprocess.check_output(["security", "cms", "-D", "-i", str(profile)])
        info = plistlib.loads(decoded)
        entitlements = info.get("Entitlements", {})
        prefixes = info.get("ApplicationIdentifierPrefix", [])
        allowed_ids = {f"{prefix}.{bundle}" for prefix in prefixes}
        if team not in info.get("TeamIdentifier", []) or entitlements.get("application-identifier") not in allowed_ids:
            raise SystemExit("Profile must match this candidate's exact bundle identifier and signing team")
        expires = info.get("ExpirationDate")
        if not isinstance(expires, datetime.datetime) or expires <= datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None):
            raise SystemExit("Provisioning profile has expired")
        if entitlements.get("get-task-allow", False):
            raise SystemExit("Use an Apple Distribution profile, not a development profile")
        if method == "release-testing" and not info.get("ProvisionedDevices"):
            raise SystemExit("Release testing needs an ad hoc profile listing the test devices")
        if method == "app-store-connect" and (info.get("ProvisionedDevices") or info.get("ProvisionsAllDevices")):
            raise SystemExit("App Store Connect export needs an App Store distribution profile")
        import uuid
        profile_uuid = str(uuid.UUID(info["UUID"]))
        profiles = Path.home() / "Library/MobileDevice/Provisioning Profiles"
        profiles.mkdir(parents=True, exist_ok=True)
        profile_installed = profiles / f"{profile_uuid}.mobileprovision"
        if profile_installed.exists():
            raise SystemExit("Refusing to overwrite an existing provisioning profile")
        keychain_password = secrets.token_urlsafe(32)
        print(f"::add-mask::{keychain_password}", flush=True)
        try:
            run("security", "create-keychain", "-p", keychain_password, str(keychain))
            keychain_created = True
            run("security", "set-keychain-settings", "-lut", "21600", str(keychain))
            run("security", "unlock-keychain", "-p", keychain_password, str(keychain))
            run("security", "import", str(certificate), "-P", os.environ["IOS_CERTIFICATE_PASSWORD"], "-A", "-t", "cert", "-f", "pkcs12", "-k", str(keychain))
            run("security", "set-key-partition-list", "-S", "apple-tool:,apple:", "-k", keychain_password, str(keychain), stdout=subprocess.DEVNULL)
            run("security", "list-keychains", "-d", "user", "-s", str(keychain), *previous_keychains)
            profile_installed.write_bytes(profile.read_bytes())
            archive = temporary / "LivePlanner.xcarchive"
            run("xcodebuild", "-project", str(root / "LivePlanner.xcodeproj"), "-scheme", "LivePlanner",
                "-configuration", "Release", "-destination", "generic/platform=iOS", "-archivePath", str(archive),
                "archive", "CODE_SIGN_STYLE=Manual", f"DEVELOPMENT_TEAM={team}", "CODE_SIGN_IDENTITY=Apple Distribution",
                f"PROVISIONING_PROFILE_SPECIFIER={profile_uuid}", f"CURRENT_PROJECT_VERSION={os.environ.get('GITHUB_RUN_NUMBER', '1')}")
            options = temporary / "ExportOptions.plist"
            options.write_bytes(plistlib.dumps({"method": method, "destination": "export", "teamID": team,
                "signingStyle": "manual", "signingCertificate": "Apple Distribution",
                "provisioningProfiles": {bundle: profile_uuid}, "manageAppVersionAndBuildNumber": False}))
            run("xcodebuild", "-exportArchive", "-archivePath", str(archive), "-exportPath", str(output), "-exportOptionsPlist", str(options))
            if not list(output.glob("*.ipa")):
                raise SystemExit("Export did not produce an IPA")
            (output / "build-evidence.json").write_text(json.dumps({"source": os.environ.get("GITHUB_SHA"),
                "bundle": bundle, "method": method, "uploadedToApple": False}, indent=2))
        finally:
            if profile_installed.exists():
                profile_installed.unlink()
            if keychain_created:
                subprocess.run(["security", "list-keychains", "-d", "user", "-s", *previous_keychains], check=False)
                subprocess.run(["security", "delete-keychain", str(keychain)], check=False)


if __name__ == "__main__":
    try:
        main()
    except subprocess.CalledProcessError:
        # Do not print a command/traceback that may contain a signing password.
        raise SystemExit("Signing or export failed. Review the preceding tool diagnostics; command arguments are suppressed.") from None
