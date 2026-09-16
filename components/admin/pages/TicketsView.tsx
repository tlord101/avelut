import { db, onValue, ref as dbRef, remove, update } from '@/lib/backend';
import React, { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import { useToast } from '../../../hooks/useToast';

interface Ticket {
    id: string;
    name: string;
    email: string;
    subject: string;
    message: string;
    status: 'unread' | 'read' | 'resolved';
    createdAt: number;
}

export const TicketsView: React.FC = () => {
    const { addToast } = useToast();
    const [tickets, setTickets] = useState<Ticket[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);

    useEffect(() => {
        const fetchAllTickets = async () => {
            try {
                let rtdbTickets: Ticket[] = [];
                const ticketsRef = dbRef(db, 'contact_tickets');
                onValue(ticketsRef, async (snapshot) => {
                    if (snapshot.exists()) {
                        const data = snapshot.val();
                        rtdbTickets = Object.keys(data).map(key => ({
                            id: key,
                            ...data[key]
                        }));
                    }

                    // Query Supabase reports table for support tickets
                    let supaTickets: Ticket[] = [];
                    try {
                        const { data: reports } = await supabase.from('reports').select('*').order('created_at', { ascending: false });
                        if (Array.isArray(reports)) {
                            supaTickets = reports.map((r: any) => ({
                                id: r.id,
                                name: r.reporter_id || r.user_name || 'User',
                                email: r.email || r.user_email || '',
                                subject: r.title || r.type || 'Support Request',
                                message: r.details || r.content || '',
                                status: r.status || 'unread',
                                createdAt: r.created_at ? new Date(r.created_at).getTime() : Date.now(),
                            }));
                        }
                    } catch (err) {
                        console.warn('[TicketsView] Supabase reports fetch warning:', err);
                    }

                    const combined = [...rtdbTickets, ...supaTickets];
                    const map = new Map<string, Ticket>();
                    combined.forEach(t => map.set(t.id, t));
                    const sorted = Array.from(map.values()).sort((a, b) => b.createdAt - a.createdAt);

                    setTickets(sorted);
                    setIsLoading(false);
                });
            } catch (err) {
                console.error("Error fetching tickets:", err);
                setIsLoading(false);
            }
        };

        void fetchAllTickets();
    }, []);

    const updateTicketStatus = async (id: string, status: Ticket['status']) => {
        try {
            await update(dbRef(db, `contact_tickets/${id}`), { status });
            addToast(`Ticket marked as ${status}`, 'success');
            if (selectedTicket && selectedTicket.id === id) {
                setSelectedTicket({ ...selectedTicket, status });
            }
        } catch (error: any) {
            addToast('Failed to update ticket: ' + error.message, 'error');
        }
    };

    const deleteTicket = async (id: string) => {
        if (!window.confirm("Are you sure you want to delete this ticket?")) return;
        try {
            await remove(dbRef(db, `contact_tickets/${id}`));
            addToast('Ticket deleted', 'success');
            if (selectedTicket && selectedTicket.id === id) {
                setSelectedTicket(null);
            }
        } catch (error: any) {
            addToast('Failed to delete ticket: ' + error.message, 'error');
        }
    };

    if (isLoading) {
        return <div className="p-8 text-center text-slate-500 font-bold animate-pulse">Loading tickets...</div>;
    }

    const unreadCount = tickets.filter(t => t.status === 'unread').length;

    return (
        <div className="space-y-6 text-slate-900 dark:text-slate-100">
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-6">
                <div>
                    <h2 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight flex items-center gap-2">
                        <i className="bi bi-inbox-fill text-amber-500"></i>
                        <span>Support Tickets</span>
                    </h2>
                    <p className="text-sm font-medium text-slate-500 dark:text-slate-400 mt-1">
                        Manage user inquiries from the Contact Us page.
                    </p>
                </div>
                {unreadCount > 0 && (
                    <div className="bg-rose-100 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2">
                        <span className="inline-flex rounded-full h-2 w-2 bg-rose-500"></span>
                        <span>{unreadCount} Unread Ticket{unreadCount !== 1 ? 's' : ''}</span>
                    </div>
                )}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Tickets List */}
                <div className="lg:col-span-1 bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden flex flex-col max-h-[70vh]">
                    <div className="p-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50">
                        <h3 className="font-bold text-slate-900 dark:text-white text-sm">Recent Tickets</h3>
                    </div>
                    <div className="overflow-y-auto flex-1 divide-y divide-slate-100 dark:divide-slate-800">
                        {tickets.length === 0 ? (
                            <div className="p-8 text-center text-slate-500 text-sm">No tickets found.</div>
                        ) : (
                            tickets.map(ticket => (
                                <button 
                                    key={ticket.id}
                                    onClick={() => setSelectedTicket(ticket)}
                                    className={`w-full text-left p-4 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition cursor-pointer ${selectedTicket?.id === ticket.id ? 'bg-amber-500/10 border-l-4 border-amber-500' : 'border-l-4 border-transparent'} ${ticket.status === 'unread' ? 'font-bold' : ''}`}
                                >
                                    <div className="flex justify-between items-start mb-1">
                                        <span className="text-sm text-slate-900 dark:text-white truncate pr-2">{ticket.name}</span>
                                        <span className="text-[10px] text-slate-400 whitespace-nowrap">
                                            {new Date(ticket.createdAt).toLocaleDateString()}
                                        </span>
                                    </div>
                                    <div className="text-xs text-slate-600 dark:text-slate-300 truncate mb-2">{ticket.subject}</div>
                                    <div className="flex items-center justify-between">
                                        <span className={`text-[10px] px-2 py-1 rounded-md uppercase tracking-wider font-bold
                                            ${ticket.status === 'unread' ? 'bg-rose-100 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400' : 
                                              ticket.status === 'resolved' ? 'bg-emerald-100 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400' : 
                                              'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'}
                                        `}>
                                            {ticket.status}
                                        </span>
                                    </div>
                                </button>
                            ))
                        )}
                    </div>
                </div>

                {/* Ticket Details */}
                <div className="lg:col-span-2">
                    {selectedTicket ? (
                        <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden h-full flex flex-col">
                            <div className="p-6 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 flex justify-between items-start">
                                <div>
                                    <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-2">{selectedTicket.subject}</h3>
                                    <div className="flex flex-wrap items-center gap-4 text-sm text-slate-500 dark:text-slate-400">
                                        <span className="flex items-center gap-1.5"><i className="bi bi-person text-xs"></i> {selectedTicket.name}</span>
                                        <a href={`mailto:${selectedTicket.email}`} className="flex items-center gap-1.5 hover:text-amber-500 transition"><i className="bi bi-envelope text-xs"></i> {selectedTicket.email}</a>
                                        <span className="flex items-center gap-1.5"><i className="bi bi-clock text-xs"></i> {new Date(selectedTicket.createdAt).toLocaleString()}</span>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2">
                                    {selectedTicket.status === 'unread' && (
                                        <button onClick={() => updateTicketStatus(selectedTicket.id, 'read')} className="p-2 text-slate-400 hover:text-amber-500 hover:bg-amber-500/10 rounded-xl transition cursor-pointer" title="Mark as Read">
                                            <i className="bi bi-envelope-open text-base"></i>
                                        </button>
                                    )}
                                    {selectedTicket.status !== 'resolved' && (
                                        <button onClick={() => updateTicketStatus(selectedTicket.id, 'resolved')} className="p-2 text-slate-400 hover:text-emerald-500 hover:bg-emerald-500/10 rounded-xl transition cursor-pointer" title="Mark as Resolved">
                                            <i className="bi bi-check2-circle text-base"></i>
                                        </button>
                                    )}
                                    <button onClick={() => deleteTicket(selectedTicket.id)} className="p-2 text-slate-400 hover:text-rose-500 hover:bg-rose-500/10 rounded-xl transition cursor-pointer" title="Delete Ticket">
                                        <i className="bi bi-trash text-base"></i>
                                    </button>
                                </div>
                            </div>
                            <div className="p-6 flex-1 bg-white dark:bg-slate-900 overflow-y-auto">
                                <div className="prose prose-sm max-w-none text-slate-700 dark:text-slate-300 whitespace-pre-wrap">
                                    {selectedTicket.message}
                                </div>
                            </div>
                            <div className="p-4 bg-slate-50 dark:bg-slate-800/50 border-t border-slate-100 dark:border-slate-800 text-right">
                                <a href={`mailto:${selectedTicket.email}?subject=Re: ${selectedTicket.subject}`} className="inline-flex items-center gap-2 bg-slate-900 dark:bg-amber-500 hover:bg-slate-800 dark:hover:bg-amber-400 text-white dark:text-slate-950 px-6 py-2.5 rounded-xl font-bold transition shadow-sm">
                                    <i className="bi bi-reply-fill text-sm"></i>
                                    <span>Reply via Email</span>
                                </a>
                            </div>
                        </div>
                    ) : (
                        <div className="bg-slate-50 dark:bg-slate-900/50 rounded-3xl border border-dashed border-slate-200 dark:border-slate-800 h-full flex flex-col items-center justify-center text-slate-400 p-8">
                            <i className="bi bi-inbox text-5xl mb-3 text-slate-300 dark:text-slate-700 block"></i>
                            <p className="font-medium">Select a ticket from the list to view details</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
