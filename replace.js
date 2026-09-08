const fs = require('fs');
const files = [
  "c:/Users/ADMIN/Documents/trae_projects/avelut/components/tutorial/TeachingEngineSessionView.tsx",
  "c:/Users/ADMIN/Documents/trae_projects/avelut/components/tutorial/live-teaching/TeachingBoard.tsx",
  "c:/Users/ADMIN/Documents/trae_projects/avelut/components/tutorial/live-teaching/TeachingControls.tsx",
  "c:/Users/ADMIN/Documents/trae_projects/avelut/components/tutorial/live-teaching/TeachingHeader.tsx",
  "c:/Users/ADMIN/Documents/trae_projects/avelut/components/tutorial/live-teaching/LecturerAskModal.tsx",
  "c:/Users/ADMIN/Documents/trae_projects/avelut/components/tutorial/live-teaching/LiveTranscriptSubtitles.tsx",
  "c:/Users/ADMIN/Documents/trae_projects/avelut/components/tutorial/live-teaching/QuestionOverlay.tsx"
];

for(let f of files) {
  let c = fs.readFileSync(f, 'utf8');
  c = c.replaceAll('#070B14', '#000000');
  c = c.replaceAll('#131E32', '#111111');
  c = c.replaceAll('#131E35', '#111111');
  c = c.replaceAll('#0B1120', '#080808');
  c = c.replaceAll('#1E2E4A', '#1A1A1A');
  c = c.replaceAll('#1E293B', '#222222');
  
  c = c.replaceAll(' shadow-[0_0_10px_#38BDF8]', '');
  c = c.replaceAll('shadow-[0_0_10px_#38BDF8]', '');
  c = c.replaceAll(' shadow-[0_0_14px_rgba(56,189,248,0.3)]', '');
  c = c.replaceAll('shadow-[0_0_14px_rgba(56,189,248,0.3)]', '');
  c = c.replaceAll(' shadow-[0_0_8px_#38BDF8]', '');
  c = c.replaceAll('shadow-[0_0_8px_#38BDF8]', '');
  c = c.replaceAll(' shadow-[0_0_16px_#38BDF8]', '');
  c = c.replaceAll('shadow-[0_0_16px_#38BDF8]', '');
  c = c.replaceAll(' shadow-[0_0_8px_#34D399]', '');
  c = c.replaceAll('shadow-[0_0_8px_#34D399]', '');
  
  if (f.endsWith('TeachingBoard.tsx')) {
    c = c.replaceAll('bg-[#0F172A]/90', 'bg-black/90');
    c = c.replaceAll('border-[#38BDF8]/40', 'border-white/20');
  }
  
  fs.writeFileSync(f, c);
}
console.log('done');
