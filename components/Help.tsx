
import React from 'react';

// WhatsApp Icon component defined directly to keep it self-contained
const WhatsAppIcon: React.FC<{ className?: string }> = ({ className = 'w-5 h-5' }) => (
  <svg xmlns="http://www.w3.org/2000/svg" className={className} viewBox="0 0 448 512" fill="currentColor">
    <path d="M380.9 97.1C339 55.1 283.2 32 223.9 32c-122.4 0-222 99.6-222 222 0 39.1 10.2 77.3 29.6 111L0 480l117.7-30.9c32.4 17.7 68.9 27 106.1 27h.1c122.3 0 224.1-99.6 224.1-222 0-59.3-25.2-115-67.1-157zm-157 341.6c-33.8 0-67.6-9.5-97.8-27.2l-6.9-4.1-72.3 19 19.3-70.4-4.5-7.2c-19.3-30.9-29.8-67.3-29.8-105.4 0-107.6 87.5-195 195.1-195 52.1 0 101.4 20.3 137.9 56.8 36.6 36.6 56.9 85.8 56.9 137.9-.1 107.6-87.5 195-195.2 195zm105.2-124.5c-4.9-2.4-28.9-14.3-33.4-15.9-4.5-1.6-7.8-2.4-11.1 2.4-3.3 4.9-12.6 15.9-15.5 19.2-2.9 3.3-5.8 3.7-10.8 1.2-5-2.4-21-7.8-39.9-24.6-14.7-13.2-24.8-29.6-27.8-34.8s-.3-7.8 2.1-10.2c2.2-2.2 4.9-5.8 7.3-8.6 2.4-2.8 3.3-4.9 4.9-8.2 1.6-3.3.8-6.1-.4-8.6-1.2-2.4-11.1-26.6-15.2-36.3-4.1-9.7-8.2-8.3-11.3-8.5-3.1-.2-6.7-.2-10.3-.2s-9.7 1.2-14.8 6.1c-5.1 4.9-19.5 19-19.5 46.2s19.9 53.7 22.7 57.4c2.8 3.7 39.1 59.7 94.8 83.8 12.9 5.6 24.3 8.9 32.7 11.3 14.3 4.1 27.2 3.6 37.4 2.2 11.2-1.6 34.2-13.9 39-27.3s4.9-25 3.3-27.3c-1.5-2.4-4.9-3.7-10.3-6.2z"/>
  </svg>
);

const BlueVerifiedBadge: React.FC<{ className?: string }> = ({ className = 'w-5 h-5' }) => (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor">
      <g>
        <path fill="#1D9BF0" d="M22.25 12c0-1.43-.88-2.67-2.19-3.34.46-1.39.2-2.9-.81-3.91s-2.52-1.27-3.91-.81c-.66-1.31-1.91-2.19-3.34-2.19s-2.67.88-3.33 2.19c-1.4-.46-2.9-.2-3.92.81s-1.26 2.52-.8 3.91c-1.31.67-2.2 1.91-2.2 3.34s.89 2.67 2.2 3.32c-.46 1.39-.21 2.91.8 3.92s2.51 1.26 3.91.81c.67 1.31 1.91 2.19 3.34 2.19s2.68-.88 3.34-2.19c1.39.45 2.9.21 3.91-.81s1.27-2.52.81-3.91c1.31-.65 2.19-1.89 2.19-3.32z"></path>
        <path fill="#fff" d="M9.81 14.73l-2.45-2.45c-.3-.3-.78-.3-1.08 0s-.3.78 0 1.08l3 3c.15.15.34.22.54.22s.39-.07.54-.22l5.95-5.95c.3-.3.3-.78 0-1.08s-.78-.3-1.08 0l-5.4 5.4z"></path>
      </g>
    </svg>
);

interface HelpProps {
  onStartTour: () => void;
}

const Help: React.FC<HelpProps> = ({ onStartTour }) => {
    const contributors = [
        { name: 'Tlord', number: '+2349078840517', verified: 'blue' as const },
        { name: 'Laurina', number: '+2349162458352', verified: 'blue' as const },
        { name: 'Busola', number: '+2347013123955', verified: 'blue' as const },
        { name: 'Osmond', number: '+2348076022922', verified: 'blue' as const },
        { name: 'Blessing', number: '+2349163637587', verified: 'blue' as const },
        { name: 'Joseph', number: '+2348122393289', verified: 'blue' as const },
        { name: 'Cloud', number: '+2347010775761', verified: 'blue' as const },
        { name: 'Curry', number: '+2349015131371', verified: 'blue' as const },
        { name: 'Thrillz', number: '+2349133347947', verified: 'blue' as const }
    ];

    const formatWhatsAppLink = (number: string) => {
        const cleanedNumber = number.replace(/\D/g, ''); // Remove all non-digit characters
        return `https://wa.me/${cleanedNumber}`;
    };
    
    return (
        <div className="flex-1 flex flex-col w-full bg-white p-4 sm:p-6 md:p-8 items-center justify-center">
            <div className="max-w-2xl w-full">
                <header className="text-center mb-10">
                    <h1 className="text-4xl font-extrabold bg-gradient-to-r from-lime-600 to-teal-600 text-transparent bg-clip-text pb-2">
                        Meet the Contributors
                    </h1>
                    <p className="mt-2 text-lg text-gray-600">
                        This project is made possible by a talented team. Feel free to connect with them on WhatsApp.
                    </p>
                </header>

                <main>
                    <div className="bg-gray-50 p-4 sm:p-6 rounded-xl border border-gray-200 space-y-3">
                        {contributors.map((contact, index) => (
                            <a 
                                key={index}
                                href={formatWhatsAppLink(contact.number)}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center justify-between p-4 bg-white rounded-lg border border-gray-200 hover:border-lime-500 hover:shadow-lg hover:-translate-y-1 transition-all duration-300"
                            >
                                <div>
                                    <p className="font-semibold text-gray-800 inline-flex items-center gap-1.5">
                                        {contact.name}
                                        {contact.verified === 'blue' && <BlueVerifiedBadge />}
                                    </p>
                                    <p className="text-sm text-gray-500">{contact.number}</p>
                                </div>
                                <div className="flex items-center gap-2 px-3 py-1.5 text-sm rounded-full bg-green-100 text-green-800">
                                    <WhatsAppIcon className="w-4 h-4" />
                                    <span>Chat</span>
                                </div>
                            </a>
                        ))}
                    </div>

                    <div className="mt-8 p-4 bg-white rounded-xl border border-gray-200 text-center">
                        <h3 className="font-semibold text-gray-800">Need a refresher?</h3>
                        <p className="text-sm text-gray-600 mt-1">Take a guided tour of the app's features.</p>
                        <button
                          onClick={onStartTour}
                          className="mt-3 px-4 py-2 text-sm rounded-lg bg-lime-100 text-lime-800 font-semibold hover:bg-lime-200 transition-colors"
                        >
                          Start App Tour
                        </button>
                    </div>
                </main>

                <footer className="text-center mt-12 text-gray-500">
                    <p className="text-sm mb-2">Powered By</p>
                    <div className="flex items-center justify-center gap-2">
                        <img src="/logo_icon.png" alt="AVELUT" className="w-8 h-8 object-contain" />
                        <span className="text-2xl font-bold bg-gradient-to-b from-lime-500 to-green-600 text-transparent bg-clip-text tracking-wider">
                            VANT Labs
                        </span>
                    </div>
                    <p className="text-sm mt-4">In partnership with Google Team.</p>
                </footer>
            </div>
        </div>
    );
};

export default Help;
