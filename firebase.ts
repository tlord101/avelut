import { initializeApp } from "firebase/app";
import { getDatabase, serverTimestamp } from "firebase/database";
import { getStorage } from "firebase/storage";
import { getMessaging } from "firebase/messaging";
import { 
  getAuth, 
  GoogleAuthProvider, 
  type User as FirebaseUser,
  signInAnonymously,
  onAuthStateChanged,
  signInWithCustomToken,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  updateProfile,
  signInWithPopup,
  sendPasswordResetEmail,
  signOut as firebaseSignOut
} from "firebase/auth";

// Initialize Firebase configuration reading from environment variables (Vite)
// with a safe fallback to the window-injected __firebase_config global.
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || (typeof __firebase_config !== 'undefined' ? __firebase_config.apiKey : ''),
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || (typeof __firebase_config !== 'undefined' ? __firebase_config.authDomain : ''),
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL || (typeof __firebase_config !== 'undefined' ? __firebase_config.databaseURL : ''),
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || (typeof __firebase_config !== 'undefined' ? __firebase_config.projectId : ''),
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || (typeof __firebase_config !== 'undefined' ? __firebase_config.storageBucket : ''),
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || (typeof __firebase_config !== 'undefined' ? __firebase_config.messagingSenderId : ''),
  appId: import.meta.env.VITE_FIREBASE_APP_ID || (typeof __firebase_config !== 'undefined' ? __firebase_config.appId : ''),
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID || (typeof __firebase_config !== 'undefined' ? __firebase_config.measurementId : ''),
};

const app = initializeApp(firebaseConfig);

// Initialize Realtime Database and get a reference to the service
const db = getDatabase(app);
const storage = getStorage(app);
const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();
const messaging = typeof window !== 'undefined' ? getMessaging(app) : null;

export { 
  db, 
  storage, 
  auth, 
  messaging,
  googleProvider,
  serverTimestamp,
  signInAnonymously, 
  onAuthStateChanged, 
  signInWithCustomToken, 
  createUserWithEmailAndPassword, 
  signInWithEmailAndPassword, 
  updateProfile, 
  GoogleAuthProvider, 
  signInWithPopup, 
  sendPasswordResetEmail,
  firebaseSignOut
};

export type { FirebaseUser };

/*
/**************************************************************************************************
 *                                                                                                *
 *   IIIII M   M PPPP   OOO   RRRR   TTTTT   AAA   N   N TTTTT   Read The Instructions Below        *
 *     I   MM MM P   P O   O  R   R    T    A   A  NN  N   T                                        *
 *     I   M M M PPPP  O   O  RRRR     T    AAAAA  N N N   T     Messenger will NOT work without    *
 *     I   M   M P     O   O  R R      T    A   A  N  NN   T     these security rules.              *
 *   IIIII M   M P      OOO   R  R     T    A   A  N   N   T                                        *
 *                                                                                                *
 **************************************************************************************************
 *                                                                                                *
 *   >>> ACTION REQUIRED: You must add Security Rules to Firebase. <<<                            *
 *                                                                                                *
 *   The 'PERMISSION_DENIED' error is from Firebase because it has not been configured with       *
 *   rules that allow your app to read and write data securely.                                   *
 *                                                                                                *
 *   Please follow these steps exactly:                                                           *
 *                                                                                                *
 *   1. Go to your Firebase project console.                                                      *
 *   2. For the Database: Build > Realtime Database > Rules tab.                                  *
 *   3. For Storage: Build > Storage > Rules tab.                                                 *
 *   4. Delete any existing content in the respective rules editors.                              *
 *   5. Copy the corresponding rules from "STEP 1" and "STEP 2" below.                            *
 *   6. Paste the rules into the editors and click the "Publish" button for each.                 *
 *                                                                                                *
 **************************************************************************************************
 *                                                                                                *
 * STEP 1: FIREBASE REALTIME DATABASE SECURITY RULES                                              *
 *                                                                                                *
 * --- Copy and paste the entire JSON block below into your Firebase RTDB Rules editor ---        *
 *                                                                                                *
{
  "rules": {
    "courses_data": {
      ".read": "auth != null",
      ".write": "root.child('users').child(auth.uid).child('is_admin').val() === true"
    },
    "past_questions": {
      ".read": "auth != null",
      ".write": "root.child('users').child(auth.uid).child('is_admin').val() === true"
    },
    "users": {
        ".read": "auth != null",
        "$uid": {
            ".write": "auth != null && auth.uid === $uid"
        }
    },
    "user_progress": {
        "$uid": {
            ".read": "auth != null && auth.uid === $uid",
            ".write": "auth != null && auth.uid === $uid"
        }
    },
    "exam_history": {
        "$uid": {
            ".read": "auth != null && auth.uid === $uid",
            ".write": "auth != null && auth.uid === $uid"
        }
    },
    "notifications": {
        "$uid": {
            ".read": "auth != null && auth.uid === $uid",
            ".write": "auth != null && auth.uid === $uid"
        }
    },
    "chat_conversations": {
        "$uid": {
            ".read": "auth != null && auth.uid === $uid",
            ".write": "auth != null && auth.uid === $uid"
        }
    },
    "chat_messages": {
        "$convoId": {
            ".read": "auth != null", 
            ".write": "auth != null"
        }
    },
    "user_chats": {
      "$uid": {
        ".read": "auth != null && auth.uid === $uid",
        "$chatId": {
          ".write": "auth != null && (auth.uid === $uid || (newData.hasChild('otherUserId') && root.child('user_chats/' + newData.child('otherUserId').val() + '/' + $chatId + '/otherUserId').val() === auth.uid))",
          "last_message": {
             ".write": "auth != null && (auth.uid === $uid || newData.child('sender_id').val() === auth.uid)"
          }
        }
      }
    },
    "private_messages": {
      "$chatId": {
        ".read": "root.child('user_chats').child(auth.uid).child($chatId).exists()",
        ".write": "root.child('user_chats').child(auth.uid).child($chatId).exists()",
        "$messageId": {
          ".validate": "newData.hasChildren(['sender_id', 'timestamp']) && newData.child('sender_id').val() === auth.uid",
          ".write": "!data.exists() || (data.exists() && data.child('sender_id').val() === auth.uid)"
        }
      }
    }
  }
}
 *                                                                                                *
 *                                                                                                *
 * STEP 2: FIREBASE STORAGE SECURITY RULES                                                        *
 *                                                                                                *
 * --- Copy and paste the rules below into your Firebase Storage Rules editor ---                 *
 *                                                                                                *
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /profile-pictures/{userId}/{allPaths=**} {
      allow read: if auth != null;
      allow write: if auth != null && auth.uid == userId;
    }
    match /chat-media/{allPaths=**} {
      allow read, write: if auth != null;
    }
    match /messenger-media/{chatId}/{allPaths=**} {
      allow read, write: if auth != null;
    }
  }
}
    // The chat ID is the first folder in the path.
    match /private_chats/{chatId}/{allPaths=**} {
      allow read, write: if request.auth != null && 
                          root.child('user_chats').child(request.auth.uid).child(chatId).exists();
    }
    
    // Allow users to manage their own profile pictures (publicly readable).
    match /profile-pictures/{userId} {
      allow read;
      allow write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
 *                                                                                                *
 * ============================== END OF FIREBASE SETUP ==============================            *
 *                                                                                                *
 **************************************************************************************************/