import React from 'react';
import { LogoIcon } from './icons/LogoIcon';

export default function PrivacyPolicy() {
  const lastUpdated = "June 6, 2026";

  const sections = [
    { id: "information-collection", title: "1. Information We Collect" },
    { id: "use-of-information", title: "2. How We Use Your Information" },
    { id: "data-processing", title: "3. AI Processing & Third-Party Services" },
    { id: "security-retention", title: "4. Data Security & Retention" },
    { id: "user-rights", title: "5. Your Rights & Data Deletion" },
    { id: "cookies", title: "6. Cookies & Local Storage" },
    { id: "changes", title: "7. Changes to this Privacy Policy" },
    { id: "contact", title: "8. Contact Us" }
  ];

  return (
    <div className="min-h-screen bg-[#060814] text-slate-200 font-sans selection:bg-emerald-500/30 selection:text-emerald-400">
      {/* Decorative background gradients */}
      <div className="absolute top-0 right-1/4 w-[500px] h-[500px] bg-[#0088cc]/10 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-0 left-1/4 w-[600px] h-[600px] bg-[#002d62]/30 rounded-full blur-[140px] pointer-events-none" />

      {/* Header */}
      <header className="sticky top-0 z-40 w-full border-b border-neutral-800/60 bg-[#060814]/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white p-1">
              <LogoIcon className="h-full w-full text-[#002d62]" />
            </div>
            <div>
              <span className="text-xs font-semibold uppercase tracking-[0.35em] text-emerald-500">AVELUT</span>
              <h1 className="text-lg font-bold text-slate-100 leading-none">Privacy Policy</h1>
            </div>
          </div>
          <button
            onClick={() => { window.location.href = '/'; }}
            className="flex items-center gap-2 rounded-full border border-neutral-800 bg-[#0d1122] px-4 py-2 text-xs font-bold uppercase tracking-wider text-slate-300 transition hover:border-neutral-700 hover:bg-[#131932] hover:text-white"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="19" y1="12" x2="5" y2="12" />
              <polyline points="12 19 5 12 12 5" />
            </svg>
            Back to App
          </button>
        </div>
      </header>

      {/* Main Container */}
      <main className="relative mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 gap-10 lg:grid-cols-4">
          
          {/* Sticky Table of Contents Sidebar */}
          <aside className="lg:col-span-1">
            <div className="sticky top-28 rounded-2xl border border-neutral-800/60 bg-[#0d1122]/90 p-5 backdrop-blur">
              <h3 className="text-xs font-semibold uppercase tracking-[0.25em] text-emerald-500">Navigation</h3>
              <nav className="mt-4 space-y-2">
                {sections.map(section => (
                  <a
                    key={section.id}
                    href={`#${section.id}`}
                    className="block text-sm text-slate-400 transition hover:text-white hover:translate-x-1 duration-150"
                  >
                    {section.title}
                  </a>
                ))}
              </nav>
              <div className="mt-6 pt-5 border-t border-neutral-850">
                <p className="text-[10px] text-slate-500">LAST UPDATED</p>
                <p className="text-xs font-medium text-slate-400 mt-1">{lastUpdated}</p>
              </div>
            </div>
          </aside>

          {/* Detailed Legal Content Column */}
          <article className="lg:col-span-3 prose prose-invert prose-emerald max-w-none">
            <div className="mb-8 border-b border-neutral-800/80 pb-8">
              <h2 className="text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
                Privacy Policy
              </h2>
              <p className="mt-4 text-slate-400 text-lg leading-relaxed">
                AVELUT AI ("AVELUT", "the Platform", "we", "our") is dedicated to protecting your privacy. This policy details what information we collect when you use our educational companion tools, how it is securely processed, and how you retain full control over your data.
              </p>
            </div>

            {/* Sections */}
            <div className="space-y-12">
              
              <section id="information-collection" className="scroll-mt-28">
                <h3 className="text-xl font-bold text-white mb-4">1. Information We Collect</h3>
                <p className="text-slate-300 leading-relaxed mb-4">
                  To provide our custom study roadmaps, AI chat response streaming, and document search grounding, AVELUT collects the following types of information:
                </p>
                <ul className="list-disc pl-5 space-y-2 text-slate-300">
                  <li><strong>Account Metadata:</strong> When signing up using our Firebase portal, we store your email address, name, university department, level, and registration timestamp.</li>
                  <li><strong>Academic Context Data:</strong> Your selected courses, streaks, activity logs, and specific study guide settings that you configure to tailor your learning workspace.</li>
                  <li><strong>Uploaded Course Materials:</strong> Textbook files, lecture slides, syllabus documents (PDFs, DOCX, TXT), and visual solver images that you upload to ground the AI's retrieved knowledge (RAG).</li>
                  <li><strong>Conversational Logs:</strong> The queries you type, mic audio captures, and files you attach to Avelut AI chat, along with the generated responses.</li>
                  <li><strong>Technical Usage Metrics:</strong> Daily limits records, active API session status, and basic connection data needed to prevent scraping.</li>
                </ul>
              </section>

              <section id="use-of-information" className="scroll-mt-28">
                <h3 className="text-xl font-bold text-white mb-4">2. How We Use Your Information</h3>
                <p className="text-slate-300 leading-relaxed mb-4">
                  We process data solely for educational purposes, including:
                </p>
                <ul className="list-disc pl-5 space-y-2 text-slate-300">
                  <li><strong>Personalized AI Grounding:</strong> Linking the AI assistant's system guidelines with your department syllabus and textbooks so replies are relevant to your coursework.</li>
                  <li><strong>Image & Voice Resolution:</strong> Feeding visual captures or mic inputs to multimodal generative models to explain formulas, diagrams, or read audio transcripts.</li>
                  <li><strong>Gamification Streaks & Analytics:</strong> Tracking streaks and activity logs to support student motivation.</li>
                  <li><strong>API Abuse Controls:</strong> Monitoring transaction usage counts against active limits to maintain platform performance for all students.</li>
                </ul>
              </section>

              <section id="data-processing" className="scroll-mt-28">
                <h3 className="text-xl font-bold text-white mb-4 text-[#0088cc]">3. AI Processing & Third-Party Services</h3>
                <p className="text-slate-300 leading-relaxed mb-4">
                  Our platform runs on premium cloud infrastructures. Data is processed securely through:
                </p>
                <ul className="list-disc pl-5 space-y-3 text-slate-300">
                  <li><strong>Firebase Services:</strong> User account registration is verified via Google Firebase Auth. All text prompts, notes, active profiles, and database logs are stored in Google Firebase Realtime Database. Uploaded files are hosted in Google Firebase Storage.</li>
                  <li><strong>Large Language Model Processing:</strong> When you send a prompt or file, it is processed via the Google Gemini API (including models like `gemini-1.5-pro` or preview versions configured by administrators). The contents of these prompts and files are transmitted securely via SSL and are only used to generate the immediate text or audio response. Google Gemini API terms confirm that user data processed through their developer APIs is not used to train base AI models.</li>
                </ul>
              </section>

              <section id="security-retention" className="scroll-mt-28">
                <h3 className="text-xl font-bold text-white mb-4">4. Data Security & Retention</h3>
                <p className="text-slate-305 leading-relaxed mb-4">
                  We adopt industrial-grade security controls provided by Google Cloud Platform to protect your data. All database connections and storage uploads run over HTTPS with end-to-end transport layer security (TLS).
                </p>
                <p className="text-slate-300 leading-relaxed">
                  Your chat logs and files remain associated with your user account in Firebase. We retain this data as long as your account is active to support your persistent study history.
                </p>
              </section>

              <section id="user-rights" className="scroll-mt-28">
                <h3 className="text-xl font-bold text-white mb-4 text-[#0088cc]">5. Your Rights & Data Deletion</h3>
                <div className="rounded-2xl border border-emerald-500/20 bg-emerald-950/10 p-5 mb-4">
                  <p className="text-sm font-semibold text-emerald-400 uppercase tracking-wider mb-2">Absolute Data Ownership</p>
                  <p className="text-slate-300 leading-relaxed text-sm">
                    You have complete control over your records. You can **clear specific chat threads**, **remove individual textbooks** from the Upload Center, or **delete your entire user account** from the Settings panel. Deleting your account will immediately wipe all of your files from Firebase Storage and completely erase your database profile.
                  </p>
                </div>
                <p className="text-slate-300 leading-relaxed">
                  To request manual account removal, data export, or audit records, you can also contact the administrator email provided below.
                </p>
              </section>

              <section id="cookies" className="scroll-mt-28">
                <h3 className="text-xl font-bold text-white mb-4">6. Cookies & Local Storage</h3>
                <p className="text-slate-300 leading-relaxed">
                  AVELUT does not use commercial advertising cookies. We use HTML5 Local Storage in your browser to maintain your active login token, remember dark/light styling preferences, and store basic progress pointers to speed up offline application caching (PWA).
                </p>
              </section>

              <section id="changes" className="scroll-mt-28">
                <h3 className="text-xl font-bold text-white mb-4">7. Changes to this Privacy Policy</h3>
                <p className="text-slate-300 leading-relaxed">
                  We may adjust this policy occasionally to support regulatory compliance or platform changes. The revision date is displayed at the top of this document. We encourage users to check this page periodically for updates.
                </p>
              </section>

              <section id="contact" className="scroll-mt-28">
                <h3 className="text-xl font-bold text-white mb-4">8. Contact Us</h3>
                <p className="text-slate-300 leading-relaxed">
                  If you have any requests or suggestions concerning how your privacy is handled at AVELUT, please write to us at:
                </p>
                <div className="mt-4 rounded-2xl bg-[#0d1122]/60 p-4 border border-neutral-800/40 inline-block">
                  <p className="text-sm">
                    <span className="text-slate-400">Privacy Administrator:</span>{' '}
                    <a href="mailto:davidowei984@gmail.com" className="font-semibold text-emerald-400 hover:underline">
                      davidowei984@gmail.com
                    </a>
                  </p>
                </div>
              </section>

            </div>
          </article>

        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-neutral-800/60 bg-[#0d1122] py-8 text-center text-xs text-slate-500">
        <p>&copy; {new Date().getFullYear()} AVELUT AI. All rights reserved.</p>
        <div className="mt-2 flex justify-center gap-4">
          <a href="/policy" className="hover:text-slate-300 hover:underline">Privacy Policy</a>
          <span>&middot;</span>
          <a href="/t&c" className="hover:text-slate-300 hover:underline">Terms & Conditions</a>
        </div>
      </footer>
    </div>
  );
}
