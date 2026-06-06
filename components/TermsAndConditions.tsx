import React from 'react';
import { LogoIcon } from './icons/LogoIcon';

export default function TermsAndConditions() {
  const lastUpdated = "June 6, 2026";

  const sections = [
    { id: "acceptance", title: "1. Acceptance of Terms" },
    { id: "services", title: "2. Description of Services" },
    { id: "eligibility", title: "3. Eligibility & User Accounts" },
    { id: "academic-integrity", title: "4. Academic Integrity Policy" },
    { id: "acceptable-use", title: "5. Acceptable Use Guidelines" },
    { id: "intellectual-property", title: "6. Intellectual Property & Uploaded Content" },
    { id: "disclaimers", title: "7. AI Accuracy & Liability Disclaimers" },
    { id: "termination", title: "8. Account Suspension & Termination" },
    { id: "governing-law", title: "9. Governing Law & Dispute Resolution" },
    { id: "contact", title: "10. Contact Information" }
  ];

  return (
    <div className="min-h-screen bg-[#060814] text-slate-200 font-sans selection:bg-emerald-500/30 selection:text-emerald-400">
      {/* Decorative background gradients */}
      <div className="absolute top-0 left-1/4 w-[500px] h-[500px] bg-[#0088cc]/10 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-0 right-1/4 w-[600px] h-[600px] bg-[#002d62]/30 rounded-full blur-[140px] pointer-events-none" />

      {/* Header */}
      <header className="sticky top-0 z-40 w-full border-b border-neutral-800/60 bg-[#060814]/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white p-1">
              <LogoIcon className="h-full w-full text-[#002d62]" />
            </div>
            <div>
              <span className="text-xs font-semibold uppercase tracking-[0.35em] text-emerald-500">AVELUT</span>
              <h1 className="text-lg font-bold text-slate-100 leading-none">Terms of Service</h1>
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
                Terms and Conditions
              </h2>
              <p className="mt-4 text-slate-400 text-lg leading-relaxed">
                Welcome to AVELUT (accessible via https://avelut.xyz). Please read these Terms of Service carefully before utilizing our AI-powered tutoring workspace, visual solver, study guide, and academic companion platform.
              </p>
            </div>

            {/* Sections */}
            <div className="space-y-12">
              
              <section id="acceptance" className="scroll-mt-28">
                <h3 className="text-xl font-bold text-white mb-4">1. Acceptance of Terms</h3>
                <p className="text-slate-300 leading-relaxed mb-4">
                  By registering an account, logging in, or otherwise accessing AVELUT ("the Platform", "the Service", "we", "our"), you signify that you have read, understood, and agree to be bound by these Terms of Service in their entirety.
                </p>
                <p className="text-slate-300 leading-relaxed">
                  If you do not agree to these terms, you are not authorized to use this platform. We reserve the right to modify these terms at any time. Changes take effect immediately upon their publication on this page. Your continued use of the platform after updates signifies acceptance of the revised Terms.
                </p>
              </section>

              <section id="services" className="scroll-mt-28">
                <h3 className="text-xl font-bold text-white mb-4">2. Description of Services</h3>
                <p className="text-slate-300 leading-relaxed mb-4">
                  AVELUT is an AI-powered personalized study ecosystem designed to assist university students in their learning roadmap. The Platform provides tools including:
                </p>
                <ul className="list-disc pl-5 space-y-2 text-slate-300 mb-4">
                  <li><strong>AVELUT AI Chat Companion:</strong> Natural language chat interface answering academic questions grounded in your syllabus.</li>
                  <li><strong>Visual Solver:</strong> Image analysis tools to help decode and explain formulas, diagrams, and study questions.</li>
                  <li><strong>Study Guide Organizer:</strong> Tools to create personalized notes, study roadmaps, and test preparation schedules.</li>
                  <li><strong>Textbook Upload Center:</strong> Document processing features enabling users to ground AI context in specific reference materials (RAG).</li>
                </ul>
                <p className="text-slate-300 leading-relaxed">
                  We leverage advanced models (including Google Gemini API) to power our services. You acknowledge that AI capabilities are iterative, and the scope of services is subject to change at our sole discretion.
                </p>
              </section>

              <section id="eligibility" className="scroll-mt-28">
                <h3 className="text-xl font-bold text-white mb-4">3. Eligibility & User Accounts</h3>
                <p className="text-slate-300 leading-relaxed mb-4">
                  To access AVELUT, you must create a secure user account utilizing our Firebase Authentication portal. You represent and warrant that:
                </p>
                <ul className="list-disc pl-5 space-y-2 text-slate-300 mb-4">
                  <li>You will provide accurate, current, and complete registration information (including university department and academic level).</li>
                  <li>You are responsible for maintaining the confidentiality of your credentials and all activities occurring under your account.</li>
                  <li>You will notify us immediately of any unauthorized use of your credentials or security breach.</li>
                </ul>
              </section>

              <section id="academic-integrity" className="scroll-mt-28">
                <h3 className="text-xl font-bold text-white mb-4 text-[#0088cc]">4. Academic Integrity Policy</h3>
                <div className="rounded-2xl border border-red-500/20 bg-red-950/10 p-5 mb-4">
                  <p className="text-sm font-semibold text-red-400 uppercase tracking-wider mb-2">Crucial Academic Compliance Notice</p>
                  <p className="text-slate-300 leading-relaxed text-sm">
                    AVELUT is built as a study aid, explanation companion, and research reference. We strongly endorse academic integrity. <strong>You agree that you will not use AVELUT to engage in plagiarism, cheat during active exams, write papers for submission, or violate your university's student code of conduct.</strong>
                  </p>
                </div>
                <p className="text-slate-300 leading-relaxed">
                  Any usage of AVELUT’s visual solver or chat capabilities to solve live assessment questions during examination windows is strictly prohibited. You are solely responsible for ensuring your utilization of the Platform aligns with your institution's specific honor codes.
                </p>
              </section>

              <section id="acceptable-use" className="scroll-mt-28">
                <h3 className="text-xl font-bold text-white mb-4">5. Acceptable Use Guidelines</h3>
                <p className="text-slate-300 leading-relaxed mb-4">
                  You agree not to abuse or exploit the platform. Specifically, you must not:
                </p>
                <ul className="list-disc pl-5 space-y-2 text-slate-300">
                  <li>Circumvent or attempt to bypass established API usage limits, token counts, or paywall features.</li>
                  <li>Use scripts, bots, or automated scrapers to query the AI, download textbook content, or stress platform networks.</li>
                  <li>Upload any files, images, or textbooks containing malicious code, viruses, or spyware.</li>
                  <li>Submit prompts or upload content that is illegal, abusive, harassing, defaming, or violates third-party copyrights.</li>
                  <li>Attempt to reverse-engineer or extract the underlying prompt designs, system instructions, or proprietary code of the Platform.</li>
                </ul>
              </section>

              <section id="intellectual-property" className="scroll-mt-28">
                <h3 className="text-xl font-bold text-white mb-4">6. Intellectual Property & Uploaded Content</h3>
                <p className="text-slate-300 leading-relaxed mb-4">
                  <strong>Our Materials:</strong> All proprietary code, styles, design assets, logos, and UI patterns rendered on AVELUT are the intellectual property of AVELUT and protected by copyright laws. You receive a non-transferable, revocable license to access these services for personal educational use.
                </p>
                <p className="text-slate-300 leading-relaxed mb-4">
                  <strong>Your Uploads:</strong> When you upload textbooks, syllabus PDFs, or visual materials to the Upload Center, you represent that you possess the necessary copyright or distribution license to use those materials. You retain ownership of your uploaded files.
                </p>
                <p className="text-slate-300 leading-relaxed">
                  By uploading files, you grant AVELUT a temporary, non-exclusive, secure license to host, read, and run semantic embeddings on those materials for the sole purpose of feeding context to the AI (RAG) during your specific learning session. We do not distribute or share your uploaded files publicly.
                </p>
              </section>

              <section id="disclaimers" className="scroll-mt-28">
                <h3 className="text-xl font-bold text-white mb-4 text-[#0088cc]">7. AI Accuracy & Liability Disclaimers</h3>
                <div className="rounded-2xl border border-yellow-500/20 bg-yellow-950/15 p-5 mb-4">
                  <p className="text-sm font-semibold text-yellow-500 uppercase tracking-wider mb-2">Generative AI Output Notice</p>
                  <p className="text-slate-300 leading-relaxed text-sm">
                    AVELUT utilizes state-of-the-art Large Language Models (LLMs) to answer academic questions. <strong>Generative AI models are subject to hallucinations, errors, and omissions. AVELUT does not guarantee the absolute accuracy, completeness, or grades of any answers provided by the AI.</strong> You must verify equations, citations, and answers independently before submitting work.
                  </p>
                </div>
                <p className="text-slate-300 leading-relaxed">
                  TO THE MAXIMUM EXTENT PERMITTED BY LAW, AVELUT IS PROVIDED "AS IS" AND "AS AVAILABLE" WITHOUT WARRANTIES OF ANY KIND. WE DISCLAIM ALL LIABILITY FOR DIRECT, INDIRECT, INCIDENTAL, OR CONSEQUENTIAL LOSSES RESULTING FROM ACCIDENT, AI SYSTEM ERROR, SYSTEM DOWNTIME, OR INACCURACIES IN INTELLECTUAL OUTPUTS.
                </p>
              </section>

              <section id="termination" className="scroll-mt-28">
                <h3 className="text-xl font-bold text-white mb-4">8. Account Suspension & Termination</h3>
                <p className="text-slate-300 leading-relaxed">
                  We reserve the right to suspend, lock, or delete your user account and erase database contents without prior notice if we detect a breach of these Terms, excessive API usage patterns suggesting scraping, or any violation of academic integrity. You may delete your account and associated database details at any time via the Settings panel.
                </p>
              </section>

              <section id="governing-law" className="scroll-mt-28">
                <h3 className="text-xl font-bold text-white mb-4">9. Governing Law & Dispute Resolution</h3>
                <p className="text-slate-300 leading-relaxed">
                  These Terms of Service are governed by and construed in accordance with the local laws of the platform's operating jurisdiction, without regard to conflict of law principles. Any dispute arising under these terms shall be subject to the exclusive jurisdiction of the state or federal courts within our primary operational location.
                </p>
              </section>

              <section id="contact" className="scroll-mt-28">
                <h3 className="text-xl font-bold text-white mb-4">10. Contact Information</h3>
                <p className="text-slate-300 leading-relaxed">
                  If you have any questions, clarifications, or reports regarding academic integrity violations, please reach out to our team at:
                </p>
                <div className="mt-4 rounded-2xl bg-[#0d1122]/60 p-4 border border-neutral-800/40 inline-block">
                  <p className="text-sm">
                    <span className="text-slate-400">Support Email:</span>{' '}
                    <a href="mailto:davidowei984@gmail.com" className="font-semibold text-emerald-400 hover:underline">
                      davidowei984@gmail.com
                    </a>
                  </p>
                  <p className="text-sm mt-1">
                    <span className="text-slate-400">Operational Domain:</span>{' '}
                    <span className="font-semibold text-white">https://avelut.xyz</span>
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
