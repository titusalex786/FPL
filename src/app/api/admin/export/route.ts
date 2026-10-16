import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireAdmin } from '@/lib/auth/is-admin';
import { toNumericJerseySize } from '@/lib/utils/jersey-size';

export async function GET() {
  try {
    await requireAdmin();
    const supabase = createAdminClient();

    const { data: rows, error } = await supabase.from('registrations').select(`
        registration_number,
        registration_status,
        waitlist_position,
        registered_name_snapshot,
        registered_role_snapshot,
        registered_batting_style_snapshot,
        registered_jersey_size_snapshot,
        registered_at,
        player:players (
          full_name,
          email,
          cricket_role,
          batting_style
        ),
        payments:payments (
          amount,
          payment_status,
          transaction_reference,
          verified_at
        )
      `);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Generate CSV Header & Lines
    const headers = [
      'Registration Reference',
      'Player Name',
      'Email',
      'Cricket Role',
      'Batting Style',
      'Jersey Size',
      'Registration Status',
      'Payment Status',
      'Amount (INR)',
      'Transaction Ref / UTR',
      'Registration Date',
    ];

    const csvLines: string[] = [];
    csvLines.push(headers.join(','));

    (rows || []).forEach((row: any) => {
      const p = row.player || {};
      const pay = Array.isArray(row.payments) ? row.payments[0] : row.payments || {};

      const line = [
        `"${row.registration_number || ''}"`,
        `"${row.registered_name_snapshot || p.full_name || ''}"`,
        `"${p.email || ''}"`,
        `"${row.registered_role_snapshot || p.cricket_role || ''}"`,
        `"${row.registered_batting_style_snapshot || p.batting_style || ''}"`,
        `"${toNumericJerseySize(row.registered_jersey_size_snapshot) || '40'}"`,
        `"${row.registration_status || ''}"`,
        `"${pay.payment_status || 'PENDING'}"`,
        `"${pay.amount ? pay.amount / 100 : 500}"`,
        `"${pay.transaction_reference || ''}"`,
        `"${row.registered_at || ''}"`,
      ];
      csvLines.push(line.join(','));
    });

    const csvContent = csvLines.join('\n');

    return new NextResponse(csvContent, {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename=cricket_registrations_${Date.now()}.csv`,
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Export error' }, { status: 500 });
  }
}
