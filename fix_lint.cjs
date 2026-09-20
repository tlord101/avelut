const fs = require('fs');

const path = 'components/tutorial/LiveSynchronizedTutorialView.tsx';
let content = fs.readFileSync(path, 'utf8');

// The linter wants addToast in the dependency array
content = content.replace("}, [topicTitle, effectiveUserName]);", "}, [topicTitle, effectiveUserName, addToast]);");

fs.writeFileSync(path, content, 'utf8');
console.log('Fixed lint issue');
