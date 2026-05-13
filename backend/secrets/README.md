# backend/secrets/

Drop these here. They are gitignored by `secrets/.gitignore`.

| File | Source | Used by |
|---|---|---|
| `gcp-tts-service-account.json` | GCP IAM → Service Accounts → `tts-backend` → Keys → JSON | `GOOGLE_CLOUD_TTS_KEY_FILE` env |

See [docs/deployment-guide.md](../../docs/deployment-guide.md) Step 2.3.b for how to obtain.

**Never commit anything in this folder.** Verify with `git status` before commit.
