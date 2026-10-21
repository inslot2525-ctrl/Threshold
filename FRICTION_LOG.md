# Friction log

What we hit building Threshold and `ring-partner-mcp` for the Amazon Build, Ship, Shape hackathon (Oct 2026).
Every entry was reproduced during the build. Severity: **High** blocks a feature, **Medium** costs hours, **Low** costs minutes.

| # | Area | Severity | One line |
|---|---|---|---|
| 1 | Ring Playground | High | Snapshot and clip APIs can't be tested: live views aren't recorded (416) |
| 2 | Ring sample vs. docs | High | Hello-world WebRTC offer uses `sendrecv` audio; docs require `recvonly`; stream is black |
| 3 | Ring Playground | Medium | No simulated sensors or webhook delivery, so sensor apps can't be tested end to end |
| 4 | Ring snapshots | Medium | `403 TIME_RANGE_NOT_AUTHORIZED` for windows before the token was issued, not explained on the snapshot page |
| 5 | Ring Playground | Low | 30-minute tokens with no refresh; every expiry breaks the running app |
| 6 | Ring device API | Low | `/v1/devices` doesn't say what a device is; one `/capabilities` call per device needed |
| 7 | Amazon Bedrock | High | New account's Nova Lite quota is 0; error says "Too many tokens per day" |
| 8 | AWS sign-up | Medium | Incomplete registration silently redirects every service console to a generic setup page |

---

## 1. Playground live views produce no recorded media

- **Task:** Fetch a snapshot of the Playground doorbell to use as an alert photo.
- **Steps:** Generated a Playground token. Clicked **Simulate live view event → Motion** (the stream played). Called `POST /v1/devices/{id}/media/image/download` with `latest_in_range` and with `at_timestamp` inside the event window shown by Event History. Also tried `/media/video/download`.
- **Expected:** A JPEG/MP4 from the simulated event, since Event History lists it (`event_type: on_demand`).
- **Actual:** Every request redirected to a pre-signed URL that returned `416 MEDIA_NOT_FOUND`.
- **Severity:** High. Media download is the core of most camera apps and can't be exercised without a real device and subscription.
- **Workaround:** Captured a frame from the WHEP live stream in the browser instead.
- **Suggestion:** Have Playground events write a short recorded clip and snapshot, or document on the Playground page that media download isn't available there.

## 2. The hello-world sample's WebRTC offer contradicts the WHEP docs

- **Task:** Show the live porch view in our app, starting from `ring-api-helloworld`.
- **Steps:** Copied the sample's `useWebRTCStream`, which calls `addTransceiver('audio', { direction: 'sendrecv' })` and `addTransceiver('video', { direction: 'recvonly' })`.
- **Expected:** Live video, as in the sample.
- **Actual:** The session was created (201), `ontrack` fired and the video element said playing, but frames were black. The WHEP docs say: "All media tracks must use recvonly direction... Bidirectional media (sendrecv, sendonly) is not supported."
- **Severity:** High. A silent failure; nothing in the response says the offer was wrong.
- **Workaround:** Video-only `recvonly` transceiver, as in the docs' reference implementation.
- **Suggestion:** Update the sample to match the docs, and have the WHEP endpoint reject (400) offers with unsupported directions.

## 3. No way to test sensor events or webhook delivery without a full app

- **Task:** Test our webhook handler with `contact_sensor_faulted` / `contact_sensor_cleared` events.
- **Steps:** Looked for sensor devices and webhook settings in the Playground.
- **Expected:** A simulated contact sensor, or a "send test webhook to URL" button.
- **Actual:** The Playground has one simulated doorbell and simulates only Package/Vehicle/Motion live views. Webhooks need a registered app, account linking and real devices; staging supports US-located devices only.
- **Severity:** Medium. Sensor support is brand new (early access), so this is exactly when developers need to test it.
- **Workaround:** Built a simulator that sends documented v1.1 payloads, HMAC-signed, into our own endpoint.
- **Suggestion:** Add simulated sensors to the Playground and a "send sample webhook" tool with signing, like Stripe's CLI.

## 4. Snapshot time windows are bounded by token issue time

- **Task:** Fetch the latest snapshot from the past few minutes.
- **Steps:** `latest_in_range` with `start_timestamp` = now − 5 minutes, using a Playground token issued 3 minutes earlier.
- **Expected:** 200 or 416.
- **Actual:** `403 TIME_RANGE_NOT_AUTHORIZED: Requested time range is not within authorized boundaries`. A start after the token's issue time worked.
- **Severity:** Medium. The Event History page explains consent-based time gating; the snapshot page doesn't.
- **Workaround:** Retry with a start inside the authorized window.
- **Suggestion:** Return the earliest allowed timestamp in the error `meta`, and mention the boundary on the Image Snapshots and Media Clips pages.

## 5. 30-minute Playground tokens

- **Task:** Keep a demo running while recording a video.
- **Actual:** Each expiry means generating a new token in the portal and restarting or reconfiguring the app. Closing the tab clears the token.
- **Severity:** Low.
- **Workaround:** Added a "paste token" box to our dev dashboard.
- **Suggestion:** Offer a longer-lived Playground token, or a refresh token for the Playground app.

## 6. Device type isn't on the device list

- **Task:** Let a caregiver pick "front door sensor" and "porch camera" from a list.
- **Actual:** `/v1/devices` returns name and image only. Type needs a `/capabilities` call per device (cameras have `video`, contact sensors `contact_detection`, unsupported ones are `null`). The sensor docs confirm "Device type can't be inferred from capabilities" in some cases.
- **Severity:** Low.
- **Suggestion:** Add a `device_type` / `kind` attribute to `/v1/devices`.

## 7. Bedrock: zero quota on a new account, misleading error

- **Task:** First `Converse` call to `amazon.nova-lite-v1:0` with an image.
- **Steps:** New account (ap-southeast-2), model access enabled, IAM user with `bedrock:InvokeModel`. Tried several regions and Nova models.
- **Expected:** A response, or an error saying the account has no quota.
- **Actual:** `ThrottlingException: Too many tokens per day, please wait before trying again` on the very first request. One region instead said "Your account is currently being verified". Service Quotas showed the Nova Lite quotas at 0, most "Not adjustable". A support case was needed.
- **Severity:** High for a time-boxed hackathon.
- **Workaround:** Support case filed. Meanwhile the app falls back to Amazon Rekognition `DetectLabels` and turns the labels into the same search description (clothing, carried items, position in frame, concerns), switching back to Bedrock automatically once it answers.
- **Suggestion:** Say "Your account's quota for this model is 0; request an increase" instead of a throttling message, and give hackathon participants a fast path.

## 8. Incomplete AWS registration redirects every console

- **Task:** Open Bedrock, then Rekognition, in a newly signed-up account (India).
- **Actual:** Every service redirected to `signup/billing/incomplete`, a generic "Complete your account setup" page. It read like a free-plan restriction on Bedrock; the real cause was the payment step not being finished.
- **Severity:** Medium.
- **Suggestion:** Name the missing step on that page (for example "Payment method not verified").
