"""Validate and upload an App Store IPA. Apple processing must be verified separately."""
import base64
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile


def main():
    names = ("ASC_KEY_ID", "ASC_ISSUER_ID", "ASC_PRIVATE_KEY_BASE64")
    if any(not os.environ.get(name) for name in names):
        raise SystemExit("Configure App Store Connect upload secrets before requesting delivery")
    key_id = os.environ["ASC_KEY_ID"]
    issuer = os.environ["ASC_ISSUER_ID"]
    if not re.fullmatch(r"[A-Z0-9]{10}", key_id) or not re.fullmatch(r"[0-9a-fA-F-]{36}", issuer):
        raise SystemExit("Invalid App Store Connect key or issuer identifier")
    output = Path(__file__).resolve().parents[1] / "DeviceExport"
    evidence_path = output / "build-evidence.json"
    evidence = json.loads(evidence_path.read_text())
    if evidence.get("method") != "app-store-connect":
        raise SystemExit("Only App Store Connect exports may be uploaded")
    packages = list(output.glob("*.ipa"))
    if len(packages) != 1:
        raise SystemExit("Expected exactly one exported IPA")
    with tempfile.TemporaryDirectory(prefix="liveplanner-upload-") as folder:
        private = Path(folder) / "private_keys"
        private.mkdir(mode=0o700)
        key = private / f"AuthKey_{key_id}.p8"
        key.write_bytes(base64.b64decode(os.environ["ASC_PRIVATE_KEY_BASE64"], validate=True))
        key.chmod(0o600)
        for operation in ("--validate-app", "--upload-app"):
            subprocess.run(["xcrun", "altool", operation, "--file", str(packages[0].resolve()),
                "--type", "ios", "--apiKey", key_id, "--apiIssuer", issuer,
                "--output-format", "json"], cwd=folder, check=True)
    evidence.update({"uploadedToApple": True, "processingVerified": False})
    evidence_path.write_text(json.dumps(evidence, indent=2))
    print("Apple accepted the upload command. Verify processing and the exact build in TestFlight before claiming availability.")


if __name__ == "__main__":
    try:
        main()
    except subprocess.CalledProcessError:
        raise SystemExit("Apple validation or upload failed; inspect the tool diagnostics") from None
