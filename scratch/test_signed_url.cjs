const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const envLocal = fs.readFileSync('.env.local', 'utf8');
let supabaseUrl = '';
let supabaseKey = '';

for (const line of envLocal.split('\n')) {
  if (line.startsWith('NEXT_PUBLIC_SUPABASE_URL=')) {
    supabaseUrl = line.split('=')[1].trim();
  }
  if (line.startsWith('SUPABASE_SERVICE_ROLE_KEY=')) {
    supabaseKey = line.split('=')[1].trim();
  }
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function test() {
  const { data: records } = await supabase.from('payments').select('id, payment_screenshot_url, screenshot_object_path').not('payment_screenshot_url', 'is', null).limit(20);
  
  for (const r of records) {
    if (r.screenshot_object_path) {
      const { data, error } = await supabase.storage.from('payment-screenshots').createSignedUrl(r.screenshot_object_path, 900);
      console.log(`[Object Path] ID ${r.id} (${r.screenshot_object_path}): `, { data: data ? 'ok' : null, error });
    }
    if (r.payment_screenshot_url) {
      const { data, error } = await supabase.storage.from('payment-screenshots').createSignedUrl(r.payment_screenshot_url, 900);
      console.log(`[URL Path] ID ${r.id} (${r.payment_screenshot_url}): `, { data: data ? 'ok' : null, error });
    }
  }
}

test();
