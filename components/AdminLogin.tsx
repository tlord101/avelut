import React, { useState } from 'react';
import { LogoIcon } from './icons/LogoIcon';

interface AdminLoginProps {
    onLogin: () => void;
}

export const AdminLogin: React.FC<AdminLoginProps> = ({ onLogin }) => {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (email === 'admin@vantutor.com' && password === 'zFhnR7N8xXtUjiN') {
            onLogin();
        } else {
            setError('Invalid admin credentials.');
        }
    };

    return (
        <div className="flex items-center justify-center min-h-screen bg-gray-900 p-4">
            <div className="w-full max-w-md">
                <div className="bg-gray-800 border border-gray-700 rounded-2xl p-6 sm:p-8 shadow-2xl">
                    <div className="flex justify-center items-center mb-6">
                        <LogoIcon className="w-12 h-12 text-lime-500" />
                        <h1 className="text-3xl font-bold text-white tracking-wider ml-3">
                            ADMIN PORTAL
                        </h1>
                    </div>
                    <div className="text-center mb-8">
                        <p className="text-gray-400">Secure access for system administrators only.</p>
                    </div>

                    <form onSubmit={handleSubmit} className="space-y-6">
                        {error && (
                            <div className="bg-red-500/10 border border-red-500/50 text-red-500 p-3 rounded-lg text-sm text-center">
                                {error}
                            </div>
                        )}
                        <div>
                            <label className="block text-sm font-medium text-gray-300 mb-2">
                                Admin Email
                            </label>
                            <input
                                type="email"
                                required
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                className="w-full bg-gray-700 border border-gray-600 rounded-lg py-2 px-3 text-white focus:ring-2 focus:ring-lime-500 focus:outline-none"
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-300 mb-2">
                                Password
                            </label>
                            <input
                                type="password"
                                required
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                className="w-full bg-gray-700 border border-gray-600 rounded-lg py-2 px-3 text-white focus:ring-2 focus:ring-lime-500 focus:outline-none"
                            />
                        </div>

                        <button
                            type="submit"
                            className="w-full bg-lime-500 hover:bg-lime-600 text-black font-bold py-3 rounded-lg transition-colors focus:ring-4 focus:ring-lime-500/50"
                        >
                            Access Admin Panel
                        </button>
                    </form>
                    
                    <div className="mt-8 text-center">
                        <button 
                            onClick={() => window.location.href = '/'}
                            className="text-sm text-gray-500 hover:text-gray-300"
                        >
                            Return to Student Dashboard
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};
