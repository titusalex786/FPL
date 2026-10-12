-- Publish only public auction state. Financial tables remain outside Realtime.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_publication
        WHERE pubname = 'supabase_realtime'
    ) THEN
        RAISE EXCEPTION 'Required Supabase publication supabase_realtime does not exist';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime'
          AND schemaname = 'public'
          AND tablename = 'auctions'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.auctions;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime'
          AND schemaname = 'public'
          AND tablename = 'auction_lots'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.auction_lots;
    END IF;
END;
$$;
