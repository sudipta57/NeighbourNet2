Test Flow
Test 1: Offline Queue + Online Sync
Open the app on the emulator.
Enable airplane mode in the emulator (pull down status bar → airplane mode ON).
Create an SOS (select template → SEND SOS).
✅ Message should save to SQLite and show in the queue badge.
✅ No network call should happen (airplane mode is on).
Disable airplane mode (pull down status bar → airplane mode OFF).
✅ Within ~10 seconds, gatewaySync should fire automatically.
✅ Check your backend logs — you should see a POST to /api/messages/batch.
✅ In the app, the message should move from "Queued" to "Synced" tag in the Mesh Status screen.
Test 2: Verify Backend Deduplication
Send the same SOS twice in quick succession.
✅ Both should save locally (different message_ids).
✅ When synced, backend receives both but deduplicates by body SHA-256 hash.
✅ Only one entry appears in Supabase (backend dedup).
Test 3: Partial Failure (207 Response)
Check your backend responds with 207 for partial success:
✅ Only uuid1 should be marked synced locally.
✅ uuid2 stays in the queue, will retry on next sync.
Test 4: Mesh Broadcast (Optional)
Check your native mesh module logs:

After SOS is created, broadcastMessage() is called (fire-and-forget).
If the native module is not present, it silently returns 0 (expected for emulator).
Test 5: Priority Triage
Send messages with different keywords:

"Trapped, need boat" → should score CRITICAL (0.85+).
"Safe, checking in" → should score LOW (<0.40).
"No food or water" → should score HIGH (0.65+).
Backend also runs Gemini triage on received messages:

Check Supabase messages table for priority_tier and priority_score columns.
These may differ slightly from the client's local triage (Gemini is more sophisticated).
Debugging Checklist
If sync doesn't trigger after turning off airplane mode:

Check backend is running:

Should return 200 OK.

Check API_BASE_URL is being read:

In the app, go to Mesh Status screen → look at queue badge.
Check Expo logs (run npm run start to see logs):
or
Force a manual sync (if you added a button):

Pull down status bar → toggle airplane mode OFF and wait ~10 seconds.
Or call triggerManualSync() from the app.
Check backend logs for the POST request:

If you see a 400 error:

Check request body matches the schema in your backend.
The app will log: [GatewaySync] Validation error: ...
Summary
✅ Yes, everything will work locally. The app is pre-configured to hit http://10.0.2.2:8000 on the Android emulator, which maps to your localhost backend. Just make sure:

Backend is running on localhost:8000
.env has API_BASE_URL=http://10.0.2.2:8000 (or use the default)
Emulator and backend are both reachable
Run the test flow above to validate the full sync pipeline end-to-end.

Physical device note:

- If you test on a real Android phone, set `API_BASE_URL` to your computer's LAN IP, not `10.0.2.2`.
- If you use plain `http://` for local testing, the app must be rebuilt after the cleartext setting change above.