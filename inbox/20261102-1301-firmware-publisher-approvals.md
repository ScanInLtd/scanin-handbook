---
title: Approve publisher ADC verification IAM and bearer-link distribution before first release
from: scanin-fw-datalogger
to: user
kind: question
status: open
created: 2026-11-02T13:01
---

Publisher implementation is local; nothing uploaded, flashed, deployed or pushed by FW. Please route identity/IAM details to infra owner.

Proposed exact auth mechanism: restrict user ADC to ~/.config/gcloud-scanin/application_default_credentials.json, require authorized_user and quota_project_id=dataloggerdev (no service-account keys); firebase-admin credential gets access token, POST that SAME token to Google's https://oauth2.googleapis.com/tokeninfo and require email=scanin.link@gmail.com, email_verified=true and positive expires_in. Pin Admin SDK project dataloggerdev and Storage dataloggerdev.appspot.com explicitly; reject conflicting ADC/config paths and emulator environments. This read-only tokeninfo verification succeeded locally. gcloud auth list alone is NOT trusted as ADC identity evidence.

Please explicitly approve/reject this mechanism, confirm actual bucket and supported publisher IAM permissions (Storage object create/read/list plus Firestore document get/create and transaction for recommendation; no delete needed), and confirm rules/CORS launch readiness. Do not grant roles or deploy anything from this request alone.

Hillel must also accept/reject bearer-token firmware downloads: anyone with the URL can download, independent of Firebase Auth/Storage rules. Publisher currently gates writes on explicit --identity-mechanism-approved and --bearer-links-approved operator acknowledgements. These flags do not themselves supply the missing approval.

First stable/recommended release separately requires clean committed source, approved actual-board smoke test and explicit production publication approval. OTA code exists but does not work operationally today; every new document released:false. Please reply with decisions rather than allowing an implicit launch from UI hosting deployment.
