const { initializeApp } = require('firebase/app');
const { getDatabase, ref, get } = require('firebase/database');

const config = {
  apiKey: "AIzaSyA2oJ1vB5TDQWr2-Gz72jpCl7pX8rmKmE8",
  authDomain: "tlord-1ab38.firebaseapp.com",
  databaseURL: "https://tlord-1ab38-default-rtdb.firebaseio.com",
  projectId: "tlord-1ab38",
  storageBucket: "tlord-1ab38.firebasestorage.app",
  messagingSenderId: "750743868519",
  appId: "1:750743868519:web:423b7ba5e2a3d73b6570c2"
};

const app = initializeApp(config);
const db = getDatabase(app);

async function run() {
  try {
    console.log("Fetching users from database...");
    const snap = await get(ref(db, "users"));
    if (snap.exists()) {
      const data = snap.val();
      console.log(`Successfully fetched ${Object.keys(data).length} users:`);
      for (const [uid, user] of Object.entries(data)) {
        console.log(`- UID: ${uid}`);
        console.log(`  display_name: ${user.display_name}`);
        console.log(`  displayName: ${user.displayName}`);
        console.log(`  email: ${user.email}`);
        console.log(`  department_id: ${user.department_id}`);
      }
    } else {
      console.log("No users found in database.");
    }
  } catch (err) {
    console.error("Error fetching users:", err);
  }
  process.exit(0);
}

run();
