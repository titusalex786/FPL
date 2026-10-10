'use client';

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';

export interface MyRegistrationData {
  id: string;
  tournament_id: string;
  player_id: string;
  registration_number: string;
  registration_status: string;
  registration_type: string;
  team_name?: string | null;
  waitlist_position?: number | null;
  registered_name_snapshot: string;
  registered_role_snapshot: string;
  registered_batting_style_snapshot?: string | null;
  registered_bowling_style_snapshot?: string | null;
  registered_jersey_name_snapshot?: string | null;
  registered_jersey_number_snapshot?: string | null;
  registered_jersey_size_snapshot?: string | null;
  registered_image_snapshot?: string | null;
  registered_at: string;
  admin_remarks?: string | null;
  correction_requested_at?: string | null;
  correction_history?: any[] | null;
  player?: {
    id: string;
    auth_user_id?: string;
    email?: string;
    full_name?: string;
    mobile?: string;
    profile_image_url?: string;
  } | null;
  tournament?: {
    id: string;
    name: string;
    description?: string;
    tournament_date: string;
    registration_fee: number;
    payment_enabled: boolean;
    upi_id?: string;
    payment_qr_url?: string;
  } | null;
  payment?: {
    id?: string;
    amount?: number;
    payment_status?: string;
    payment_method?: string;
    transaction_reference?: string;
    created_at?: string;
    payment_screenshot_url?: string;
    screenshot_object_path?: string;
    verification_note?: string;
  } | null;
}

interface MyRegistrationContextValue {
  registrations: MyRegistrationData[];
  loading: boolean;
  refresh: () => Promise<void>;
  getRegistrationForTournament: (tournamentId: string) => MyRegistrationData | undefined;
}

const MyRegistrationContext = createContext<MyRegistrationContextValue>({
  registrations: [],
  loading: true,
  refresh: async () => {},
  getRegistrationForTournament: () => undefined,
});

export const MyRegistrationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [registrations, setRegistrations] = useState<MyRegistrationData[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const supabase = createClient();

  const fetchRegistrations = useCallback(async () => {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setRegistrations([]);
        setLoading(false);
        return;
      }

      const res = await fetch('/api/registrations/my');
      if (res.ok) {
        const data = await res.json();
        setRegistrations(data.registrations || []);
      } else {
        setRegistrations([]);
      }
    } catch (e) {
      console.error('Error fetching registrations in context:', e);
      setRegistrations([]);
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    fetchRegistrations();

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        fetchRegistrations();
      } else {
        setRegistrations([]);
        setLoading(false);
      }
    });

    return () => {
      authListener?.subscription?.unsubscribe();
    };
  }, [supabase, fetchRegistrations]);

  const getRegistrationForTournament = useCallback(
    (tournamentId: string) => {
      return registrations.find((r) => r.tournament_id === tournamentId);
    },
    [registrations]
  );

  return (
    <MyRegistrationContext.Provider
      value={{
        registrations,
        loading,
        refresh: fetchRegistrations,
        getRegistrationForTournament,
      }}
    >
      {children}
    </MyRegistrationContext.Provider>
  );
};

export const useMyRegistrations = () => useContext(MyRegistrationContext);
