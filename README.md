# Threshold

**Night-exit alerts for dementia caregivers, built on the Ring Partner API.**

Six in ten people living with dementia will wander at least once, and many do it repeatedly
([Alzheimer's Association](https://www.alz.org/media/Documents/alzheimers-dementia-wandering-behavior-ts.pdf)).
It often happens at night, while the caregiver is asleep, and the first hour matters most.

Threshold turns Ring devices a family already owns into a night watch:

1. **Notices.** The front-door contact sensor opens inside the risk window (say 10 PM to 6 AM).
2. **Confirms.** The porch camera sees a *person* outside within 90 seconds. Vehicles, deliveries and animals are ignored.
3. **Waits.** If the door opens again within the grace period, they're likely back inside, so there's no alarm.
4. **Describes.** It pulls a snapshot and Amazon Bedrock writes a search-ready description:
   *"Person in a light robe, no coat, walking left toward the street."* Clothing and direction only, never faces or identity.
5. **Alerts.** The caregiver gets a text (Amazon SNS) and a dashboard alarm. A one-tap share page can go to neighbors or police.
6. **Spots the trend.** A weekly chart of night exits. A rise is an early warning to raise with their doctor.

## Ring APIs used

| Capability | Endpoint / event | Why |
|---|---|---|
| Webhooks v1.1 | `contact_sensor_faulted`, `contact_sensor_cleared` | Door opened / closed (sensors, early access) |
| | `motion_detected` with `sub_type` | `human` counts; `vehicle`, `package_delivery`, `other_motion` don't |
| | `button_press`, `device_online/offline` | Logged |
| Signature check | `X-Signature: sha256=<hex>` over raw body | Rejects spoofed events |
| Device discovery | `GET /v1/devices`, `/status` | Map door sensor and outdoor camera |
| Configurations | `GET /v1/devices/{id}/configurations` → `e2e_encryption.enabled` | Encrypted cameras switch to sensor-only mode instead of failing |
| Image snapshots | `POST /v1/devices/{id}/media/image/download` (`latest_in_range`, 303 → pre-signed URL) | Photo for the alert and share page |

Deduplication uses `meta.request_id`, which matters for sensors because no event history exists to reconcile against.

## Architecture

```
Ring cloud ──signed webhook──► /api/webhook ──► detector (pure state machine) ──► effects
                                                      ▲                           │
                                       2s tick ───────┘        ┌──────────────────┼───────────────────┐
                                                               ▼                  ▼                   ▼
                                                  Ring snapshot API      Amazon Bedrock         Amazon SNS
                                                  (skipped if E2EE)      (Converse, vision)     (caregiver text)
                                                               └──────────► state + live dashboard (SSE) ◄─┘
```

- `lib/engine/detector.ts`: the whole decision logic, pure and unit-tested
- `lib/ring/`: Ring auth, API client and webhook verification
- `lib/ai/describe.ts`: Bedrock prompt with privacy guardrails
- `lib/ai/labels.ts`: Rekognition fallback that turns labels into the same description
- `lib/runtime.ts`: wires engine → Ring, Bedrock, SNS, storage
- `lib/simulator.ts`: emits Ring-format, HMAC-signed webhooks for demos

## Privacy

- No face recognition, no identity or biometric description (and Ring forbids it). The model prompt explicitly excludes them.
- Cameras with end-to-end encryption (TAKE/E2EE) are respected: Threshold reads `e2e_encryption.enabled` and never tries to process their media.
- Share pages are reachable only by a random 128-bit token, are not indexed, and show no account or device details.
- Snapshots stay on the server that runs Threshold.

## Run it

Requires Node 20+.

```bash
npm install
cp .env.example .env.local   # all keys optional for the simulator
npm run dev                  # http://localhost:3000
```

**Simulator (no Ring hardware needed):** the dashboard has a demo panel. Click *Use demo timing* (20-second grace, always armed),
then *Walks out and does not come back*. Put a photo in `demo-assets/` to act as the porch camera.
The simulator sends real Ring v1.1 webhook payloads, signed with `RING_HMAC_KEY` when set, into the same `/api/webhook`
endpoint Ring uses.

**Real Ring account:** set `RING_ACCESS_TOKEN` (Playground) or the refresh-token variables, plus `RING_HMAC_KEY`.
Expose the app over HTTPS (e.g. `ngrok http 3000`), set the webhook URL in the Ring Developer Portal to
`https://<host>/api/webhook`, then click *Refresh from Ring* and map your door sensor and camera.

**AWS:** set `AWS_REGION` and credentials. Enable a vision model in Bedrock (default `us.amazon.nova-lite-v1:0`,
override with `BEDROCK_MODEL_ID`; outside US regions use `amazon.nova-lite-v1:0` or `apac.amazon.nova-lite-v1:0`).
If Bedrock fails (for example a new account whose quota is still 0), descriptions fall back to Amazon Rekognition labels
and switch back once Bedrock answers; `DESCRIBE_PROVIDER=bedrock|rekognition` pins one. For texts, create an SNS topic,
subscribe the caregiver's phone or email, and set `SNS_TOPIC_ARN`.

The IAM user needs only:

```json
{"Version":"2012-10-17","Statement":[
  {"Effect":"Allow","Action":["bedrock:InvokeModel","bedrock:Converse"],"Resource":"*"},
  {"Effect":"Allow","Action":"rekognition:DetectLabels","Resource":"*"},
  {"Effect":"Allow","Action":"sns:Publish","Resource":"*"}]}
```

## Tests

```bash
npm test          # detector, risk window across midnight, digest, webhook HMAC, payload parsing
npm run typecheck
```

## License

MIT. Ring auth helper adapted from [AmazonAppDev/ring-api-helloworld](https://github.com/AmazonAppDev/ring-api-helloworld) (MIT).
