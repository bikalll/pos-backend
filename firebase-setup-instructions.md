# Firebase Service Account Setup

To complete the backend setup, you need to create a Firebase service account key:

## Steps:

1. **Go to Firebase Console**: https://console.firebase.google.com/
2. **Select your project**: `dbarbi-4c494`
3. **Go to Project Settings** (gear icon)
4. **Click "Service accounts" tab**
5. **Click "Generate new private key"**
6. **Download the JSON file**
7. **Save it as**: `backend/firebase-service-account.json`

## Alternative: Update .env file

Or update the `.env` file with these values from the downloaded JSON:

```
FIREBASE_PROJECT_ID=dbarbi-4c494
FIREBASE_PRIVATE_KEY_ID=<private_key_id from JSON>
FIREBASE_PRIVATE_KEY="<private_key from JSON>"
FIREBASE_CLIENT_EMAIL=<client_email from JSON>
FIREBASE_CLIENT_ID=<client_id from JSON>
```

## Security Note:
- Never commit the service account JSON to version control
- Add `firebase-service-account.json` to `.gitignore`
