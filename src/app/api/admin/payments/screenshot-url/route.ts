import { NextRequest, NextResponse } from 'next/server';
import { requireManager } from '@/lib/auth/is-manager';
import { createAdminClient } from '@/lib/supabase/admin';
import { getSignedScreenshotUrl } from '@/lib/storage/upload';

export async function GET(req: NextRequest) {
  try {
    await requireManager();
    const { searchParams } = new URL(req.url);
    const path = searchParams.get('path');
    const paymentId = searchParams.get('paymentId');
    const registrationId = searchParams.get('registrationId');

    if (!path && !paymentId && !registrationId) {
      return NextResponse.json({ error: 'Missing screenshot path or identifier' }, { status: 400 });
    }

    const supabase = createAdminClient();
    let paymentRecord: any = null;
    let targetPath = '';
    let isAuthorizedPath = false;

    // 1. Look up by paymentId if provided
    if (paymentId && paymentId.trim() !== '') {
      const { data } = await supabase
        .from('payments')
        .select('id, screenshot_object_path, payment_screenshot_url, screenshot_bucket')
        .eq('id', paymentId.trim())
        .maybeSingle();
      paymentRecord = data;
    }
    // 2. Look up by registrationId if provided
    else if (registrationId && registrationId.trim() !== '') {
      const { data } = await supabase
        .from('payments')
        .select('id, screenshot_object_path, payment_screenshot_url, screenshot_bucket')
        .eq('registration_id', registrationId.trim())
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      paymentRecord = data;
    }
    // 3. Fallback to path lookup
    else if (path && path.trim() !== '') {
      const cleanPath = path.trim();
      const { data: byObjectPath } = await supabase
        .from('payments')
        .select('id, screenshot_object_path, payment_screenshot_url, screenshot_bucket')
        .eq('screenshot_object_path', cleanPath)
        .maybeSingle();

      const { data: byUrl } = !byObjectPath
        ? await supabase
            .from('payments')
            .select('id, screenshot_object_path, payment_screenshot_url, screenshot_bucket')
            .eq('payment_screenshot_url', cleanPath)
            .maybeSingle()
        : { data: null };

      paymentRecord = byObjectPath || byUrl;
      targetPath = cleanPath;
    }

    if (paymentRecord) {
      const bucket = paymentRecord.screenshot_bucket || 'payment-screenshots';
      if (bucket === 'payment-screenshots') {
        isAuthorizedPath = true;
      }
      targetPath = paymentRecord.screenshot_object_path || paymentRecord.payment_screenshot_url || targetPath;
    } else {
      // Fallback check on team_owners table
      if (registrationId && registrationId.trim() !== '') {
        const { data: ownerRecord } = await supabase
          .from('team_owners')
          .select('id, payment_screenshot_url')
          .eq('owner_registration_id', registrationId.trim())
          .maybeSingle();

        if (ownerRecord && ownerRecord.payment_screenshot_url) {
          isAuthorizedPath = true;
          targetPath = ownerRecord.payment_screenshot_url;
        }
      } else if (path && path.trim() !== '') {
        const cleanPath = path.trim();
        const { data: ownerRecord } = await supabase
          .from('team_owners')
          .select('id, payment_screenshot_url')
          .eq('payment_screenshot_url', cleanPath)
          .maybeSingle();

        if (ownerRecord) {
          isAuthorizedPath = true;
          targetPath = cleanPath;
        }
      }
    }

    if (!isAuthorizedPath || !targetPath) {
      return NextResponse.json({ error: 'Receipt reference needs reconciliation' }, { status: 404 });
    }

    // Direct image URL or base64
    if (targetPath.startsWith('http://') || targetPath.startsWith('https://') || targetPath.startsWith('data:image/')) {
      return NextResponse.json({ signedUrl: targetPath });
    }

    // Attempt to fix legacy paths that might accidentally include the bucket name
    if (targetPath.startsWith('payment-screenshots/')) {
      targetPath = targetPath.substring('payment-screenshots/'.length);
    }

    // Generate signed URL strictly for payment-screenshots bucket with 900s expiry
    const signedUrl = await getSignedScreenshotUrl('payment-screenshots', targetPath, 900);
    
    if (!signedUrl) {
      return NextResponse.json({ error: 'Receipt file unavailable' }, { status: 404 });
    }

    return NextResponse.json({ signedUrl });
  } catch (err: any) {
    const status = err.message?.includes('Unauthorized') ? 403 : 500;
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status });
  }
}
