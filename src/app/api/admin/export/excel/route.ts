import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireAdmin } from '@/lib/auth/is-admin';
import { toNumericJerseySize } from '@/lib/utils/jersey-size';

export async function GET(req: NextRequest) {
  try {
    await requireAdmin();

    const { searchParams } = new URL(req.url);
    const tournamentId = searchParams.get('tournamentId');
    const scope = searchParams.get('scope') || 'complete'; // 'approved' | 'complete'

    const supabase = createAdminClient();

    let query = supabase.from('registrations').select(`
      id,
      registration_number,
      registration_status,
      registration_type,
      team_name,
      waitlist_position,
      registered_name_snapshot,
      registered_role_snapshot,
      registered_batting_style_snapshot,
      registered_bowling_style_snapshot,
      registered_jersey_size_snapshot,
      registered_at,
      tournament:tournaments (
        id,
        name
      ),
      player:players (
        full_name,
        email,
        mobile,
        cricket_role,
        batting_style
      ),
      payments:payments (
        amount,
        payment_method,
        payment_status,
        transaction_reference,
        verified_at
      )
    `);

    if (tournamentId) {
      query = query.eq('tournament_id', tournamentId);
    }

    if (scope === 'approved') {
      query = query.eq('registration_status', 'CONFIRMED');
    }

    const { data: rows, error } = await query;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Generate CSV Header & Lines
    const headers = [
      'Tournament Name',
      'Registration Number',
      'Player Name',
      'Email',
      'Player Type',
      'Owner / Icon / Player',
      'Team Name',
      'Role',
      'Batting Style',
      'Bowling Style',
      'Jersey Name',
      'Jersey Number',
      'Jersey Size',
      'Payment Method',
      'Payment Status',
      'Registration Status',
      'Registration Date',
    ];

    const csvLines: string[] = [];
    csvLines.push(headers.join(','));

    (rows || []).forEach((row: any) => {
      const p = row.player || {};
      const t = row.tournament || {};
      const pay = Array.isArray(row.payments) ? row.payments[0] : row.payments || {};

      const typeLabel =
        row.registration_type === 'OWNER' || row.registration_type === 'TEAM_OWNER'
          ? 'OWNER'
          : row.registration_type === 'ICON' || row.registration_type === 'ICON_PLAYER'
          ? 'ICON'
          : 'PLAYER';

      const line = [
        `"${(t.name || 'Tournament').replace(/"/g, '""')}"`,
        `"${(row.registration_number || '').replace(/"/g, '""')}"`,
        `"${(row.registered_name_snapshot || p.full_name || '').replace(/"/g, '""')}"`,
        `"${(p.email || '').replace(/"/g, '""')}"`,
        `"${typeLabel}"`,
        `"${typeLabel}"`,
        `"${(row.team_name || '-').replace(/"/g, '""')}"`,
        `"${(row.registered_role_snapshot || p.cricket_role || '').replace(/"/g, '""')}"`,
        `"${(row.registered_batting_style_snapshot || p.batting_style || '').replace(/"/g, '""')}"`,
        `"${(row.registered_bowling_style_snapshot || '-').replace(/"/g, '""')}"`,
        `"${(row.registered_name_snapshot || p.full_name || '').replace(/"/g, '""')}"`,
        `"-"`,
        `"${toNumericJerseySize(row.registered_jersey_size_snapshot) || '40'}"`,
        `"${(pay.payment_method || 'UPI_QR').replace(/"/g, '""')}"`,
        `"${(pay.payment_status || 'PENDING').replace(/"/g, '""')}"`,
        `"${(row.registration_status || '').replace(/"/g, '""')}"`,
        `"${(row.registered_at || '').replace(/"/g, '""')}"`,
      ];
      csvLines.push(line.join(','));
    });

    const csvContent = csvLines.join('\n');
    const filename = `tournament_registrations_${scope}_${Date.now()}.csv`;

    return new NextResponse(csvContent, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (err: any) {
    const status = err.message?.includes('Unauthorized') ? 403 : 500;
    return NextResponse.json({ error: err.message || 'Export error' }, { status });
  }
}
