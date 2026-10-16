import { resolve } from 'node:path';
if (typeof process.loadEnvFile === 'function') process.loadEnvFile(resolve(process.cwd(), '.env.local'));
import pptxgen from 'pptxgenjs';
import { createAdminClient } from '@/lib/supabase/admin';

// Clean helper for numeric jersey sizes
function toNumericJerseySize(size?: string | null): string {
  if (!size) return '—';
  const clean = size.toUpperCase().trim();
  switch (clean) {
    case 'XS': return '36 (XS)';
    case 'S': return '38 (S)';
    case 'M': return '40 (M)';
    case 'L': return '42 (L)';
    case 'XL': return '44 (XL)';
    case 'XXL': case '2XL': return '46 (2XL)';
    case 'XXXL': case '3XL': return '48 (3XL)';
    default: return clean;
  }
}

function formatStyle(style?: string | null): string {
  if (!style || style === 'DOESNT_BOWL' || style === 'DOES_NOT_BOWL') return '—';
  return style
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

function formatRole(role?: string | null): string {
  if (!role) return 'PLAYER';
  switch (role) {
    case 'BATSMAN': return 'BATSMAN';
    case 'BOWLER': return 'BOWLER';
    case 'ALL_ROUNDER': return 'ALL ROUNDER';
    case 'WICKET_KEEPER': return 'WICKET KEEPER';
    case 'BOWLER_WICKETKEEPER': return 'BOWLER / WK';
    default: return role.replace(/_/g, ' ');
  }
}

function getRoleColors(role?: string | null): { bg: string; text: string } {
  switch (role) {
    case 'BATSMAN':
      return { bg: '059669', text: 'FFFFFF' }; // Emerald
    case 'BOWLER':
      return { bg: '0284C7', text: 'FFFFFF' }; // Sky Blue
    case 'ALL_ROUNDER':
      return { bg: 'D97706', text: 'FFFFFF' }; // Amber/Gold
    case 'WICKET_KEEPER':
    case 'BOWLER_WICKETKEEPER':
      return { bg: '7C3AED', text: 'FFFFFF' }; // Purple
    default:
      return { bg: '475569', text: 'FFFFFF' }; // Slate
  }
}

async function fetchImageAsDataUri(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = await res.arrayBuffer();
    const contentType = res.headers.get('content-type') || 'image/jpeg';
    const b64 = Buffer.from(buf).toString('base64');
    return `data:${contentType};base64,${b64}`;
  } catch (err: any) {
    console.warn(`Warning: failed to fetch remote image from ${url}:`, err.message);
    return null;
  }
}

async function generatePowerPoint() {
  console.log('=== FPL 100 Players PowerPoint Generation Starting ===');
  const supabase = createAdminClient();
  const tournamentId = 'edfb6464-c326-4ad8-af8f-b0113f9bdcf3';
  const auctionId = '5f58dd30-3188-478c-9c72-7b613309ab7c';

  // 1. Fetch Auction Lots
  console.log('Fetching auction lots...');
  const { data: lots, error: lotErr } = await supabase
    .from('auction_lots')
    .select('id, lot_number, registration_id')
    .eq('auction_id', auctionId)
    .order('lot_number', { ascending: true });

  if (lotErr) throw lotErr;
  const lotMap = new Map<string, number>();
  for (const l of (lots || [])) {
    if (l.registration_id) lotMap.set(l.registration_id, l.lot_number);
  }

  // 2. Fetch all active registrations in tournament
  console.log('Fetching tournament registrations...');
  const { data: regs, error: regErr } = await supabase
    .from('registrations')
    .select(`
      id,
      player_id,
      registered_name_snapshot,
      registered_role_snapshot,
      registered_batting_style_snapshot,
      registered_bowling_style_snapshot,
      registered_jersey_number_snapshot,
      registered_jersey_size_snapshot,
      registration_type,
      registration_status,
      team_name,
      registered_image_snapshot
    `)
    .eq('tournament_id', tournamentId)
    .neq('registration_status', 'REJECTED')
    .neq('registration_status', 'CANCELLED');

  if (regErr) throw regErr;
  console.log(`Fetched ${regs?.length} active registrations.`);

  // 3. Separate into Lots, Icons, and Others
  const lotPlayers: Array<any> = [];
  const iconPlayers: Array<any> = [];
  const otherPlayers: Array<any> = [];

  for (const r of (regs || [])) {
    const lotNum = lotMap.get(r.id);
    if (lotNum !== undefined) {
      lotPlayers.push({ ...r, lot_number: lotNum });
    } else if (r.registration_type === 'ICON') {
      iconPlayers.push(r);
    } else {
      otherPlayers.push(r);
    }
  }

  lotPlayers.sort((a, b) => a.lot_number - b.lot_number);
  iconPlayers.sort((a, b) => (a.registered_name_snapshot || '').localeCompare(b.registered_name_snapshot || ''));
  otherPlayers.sort((a, b) => (a.registered_name_snapshot || '').localeCompare(b.registered_name_snapshot || ''));

  const allPlayers = [...lotPlayers, ...iconPlayers, ...otherPlayers];
  console.log(`Total ordered players: ${allPlayers.length} (Lots: ${lotPlayers.length}, Icons: ${iconPlayers.length}, Others: ${otherPlayers.length})`);

  // 4. Pre-process photos: Convert all HTTP URLs to Base64 Data URIs
  console.log('Processing player photos (converting remote URLs to data URIs)...');
  let convertedCount = 0;
  for (let i = 0; i < allPlayers.length; i++) {
    const p = allPlayers[i];
    let img = p.registered_image_snapshot;
    if (img && (img.startsWith('http://') || img.startsWith('https://'))) {
      const dataUri = await fetchImageAsDataUri(img);
      if (dataUri) {
        p.registered_image_snapshot = dataUri;
        convertedCount++;
      }
    } else if (img && !img.startsWith('data:')) {
      // Ensure data: prefix if raw base64
      p.registered_image_snapshot = `data:image/jpeg;base64,${img}`;
    }
  }
  console.log(`Pre-fetch complete: converted ${convertedCount} remote URLs into inline base64.`);

  // 5. Build PowerPoint Presentation
  console.log('Building PowerPoint slides with PptxGenJS...');
  const pptx = new pptxgen();
  pptx.layout = 'LAYOUT_16x9';
  pptx.author = 'FPL Tournament Committee';
  pptx.company = 'Friends Premier League (FPL)';
  pptx.subject = 'Official Player Profiles — All 100 Players';
  pptx.title = 'FPL 4th Anniversary Clash of Champions — Player Profiles';

  // -------------------------------------------------------------
  // SLIDE 1: Cover Slide
  // -------------------------------------------------------------
  const coverSlide = pptx.addSlide();
  coverSlide.background = { color: '070C18' };

  // Top accent bar
  coverSlide.addShape(pptx.ShapeType.rect, {
    x: 0,
    y: 0,
    w: 13.333,
    h: 0.15,
    fill: { color: 'F59E0B' }
  });

  // Category Tag
  coverSlide.addText('CRICKET TOURNAMENT · SEASON 4', {
    x: 1.0,
    y: 1.8,
    w: 11.333,
    h: 0.5,
    fontSize: 16,
    bold: true,
    color: '38BDF8',
    fontFace: 'Arial',
    align: 'center',
    charSpacing: 4
  });

  // Main Title
  coverSlide.addText('FPL 4th Anniversary\nClash of Champions', {
    x: 1.0,
    y: 2.35,
    w: 11.333,
    h: 1.8,
    fontSize: 44,
    bold: true,
    color: 'FFFFFF',
    fontFace: 'Arial',
    align: 'center',
    lineSpacingMultiple: 1.15
  });

  // Subtitle
  coverSlide.addText('OFFICIAL PLAYER PROFILES · ALL 100 PLAYERS', {
    x: 1.0,
    y: 4.4,
    w: 11.333,
    h: 0.6,
    fontSize: 20,
    bold: true,
    color: 'F59E0B',
    fontFace: 'Arial',
    align: 'center',
    charSpacing: 2
  });

  // Details pill card
  coverSlide.addShape(pptx.ShapeType.roundRect, {
    x: 4.166,
    y: 5.3,
    w: 5.0,
    h: 0.8,
    rectRadius: 0.2,
    fill: { color: '1E293B' },
    line: { color: '334155', width: 1 }
  });

  coverSlide.addText('10 Teams  ·  100 Players  ·  Auction & Icon Rosters', {
    x: 4.166,
    y: 5.3,
    w: 5.0,
    h: 0.8,
    fontSize: 13,
    color: '94A3B8',
    fontFace: 'Arial',
    align: 'center'
  });

  // -------------------------------------------------------------
  // SLIDES 2 to 101: Player Profile Slides
  // -------------------------------------------------------------
  for (let i = 0; i < allPlayers.length; i++) {
    const p = allPlayers[i];
    const playerIndex = i + 1;
    const playerName = (p.registered_name_snapshot || 'Player Name').toUpperCase();
    const roleText = formatRole(p.registered_role_snapshot);
    const roleColors = getRoleColors(p.registered_role_snapshot);
    const battingText = formatStyle(p.registered_batting_style_snapshot);
    const bowlingText = formatStyle(p.registered_bowling_style_snapshot);
    const jerseyNum = p.registered_jersey_number_snapshot ? `#${p.registered_jersey_number_snapshot}` : '—';
    const jerseySize = toNumericJerseySize(p.registered_jersey_size_snapshot);
    const isLot = p.lot_number !== undefined;
    const categoryText = isLot ? `LOT ${p.lot_number}` : p.registration_type === 'ICON' ? 'ICON PLAYER' : 'REGISTERED PLAYER';
    const categoryBg = isLot ? '0D9488' : p.registration_type === 'ICON' ? 'D97706' : '3B82F6';

    const slide = pptx.addSlide();
    slide.background = { color: '0A0F1D' };

    // Top subtle accent bar
    slide.addShape(pptx.ShapeType.rect, {
      x: 0,
      y: 0,
      w: 13.333,
      h: 0.08,
      fill: { color: categoryBg }
    });

    // 1. HEADER: Player Name as prominent Title
    slide.addText(playerName, {
      x: 0.8,
      y: 0.35,
      w: 9.5,
      h: 0.75,
      fontSize: 28,
      bold: true,
      color: 'FFFFFF',
      fontFace: 'Arial',
      align: 'left'
    });

    // Sub-header tournament tagline
    slide.addText('FPL 4TH ANNIVERSARY CLASH OF CHAMPIONS', {
      x: 0.8,
      y: 1.05,
      w: 7.0,
      h: 0.3,
      fontSize: 10,
      bold: true,
      color: '64748B',
      fontFace: 'Arial',
      align: 'left',
      charSpacing: 2
    });

    // Player counter (top right)
    slide.addText(`${playerIndex} / ${allPlayers.length}`, {
      x: 10.533,
      y: 0.45,
      w: 2.0,
      h: 0.5,
      fontSize: 14,
      bold: true,
      color: '64748B',
      fontFace: 'Arial',
      align: 'right'
    });

    // 2. LEFT: Photo Container Frame (card)
    slide.addShape(pptx.ShapeType.roundRect, {
      x: 0.8,
      y: 1.45,
      w: 4.8,
      h: 5.4,
      rectRadius: 0.15,
      fill: { color: '0F172A' },
      line: { color: '1E293B', width: 2 }
    });

    // Photo inside card (centered, contained, uncropped)
    if (p.registered_image_snapshot) {
      try {
        slide.addImage({
          data: p.registered_image_snapshot,
          x: 0.95,
          y: 1.6,
          w: 4.5,
          h: 5.1,
          sizing: { type: 'contain', w: 4.5, h: 5.1 }
        });
      } catch (err: any) {
        console.warn(`Warning on slide ${playerIndex} (${playerName}):`, err.message);
      }
    } else {
      slide.addText('NO PHOTO\nAVAILABLE', {
        x: 0.95,
        y: 3.5,
        w: 4.5,
        h: 1.5,
        fontSize: 18,
        bold: true,
        color: '475569',
        fontFace: 'Arial',
        align: 'center'
      });
    }

    // 3. RIGHT: Player Details & Badges Panel
    slide.addShape(pptx.ShapeType.roundRect, {
      x: 5.9,
      y: 1.45,
      w: 6.633,
      h: 5.4,
      rectRadius: 0.15,
      fill: { color: '0F172A' },
      line: { color: '1E293B', width: 2 }
    });

    // Badges Row (Category Badge + Role Badge)
    // Category Badge (e.g. LOT 87 / ICON)
    slide.addShape(pptx.ShapeType.roundRect, {
      x: 6.2,
      y: 1.8,
      w: 2.0,
      h: 0.5,
      rectRadius: 0.1,
      fill: { color: categoryBg }
    });
    slide.addText(categoryText, {
      x: 6.2,
      y: 1.8,
      w: 2.0,
      h: 0.5,
      fontSize: 12,
      bold: true,
      color: 'FFFFFF',
      fontFace: 'Arial',
      align: 'center'
    });

    // Role Badge (e.g. BATSMAN / BOWLER / ALL ROUNDER)
    slide.addShape(pptx.ShapeType.roundRect, {
      x: 8.35,
      y: 1.8,
      w: 2.3,
      h: 0.5,
      rectRadius: 0.1,
      fill: { color: roleColors.bg }
    });
    slide.addText(roleText, {
      x: 8.35,
      y: 1.8,
      w: 2.3,
      h: 0.5,
      fontSize: 12,
      bold: true,
      color: roleColors.text,
      fontFace: 'Arial',
      align: 'center'
    });

    // Team badge if present
    if (p.team_name) {
      slide.addShape(pptx.ShapeType.roundRect, {
        x: 6.2,
        y: 2.45,
        w: 6.0,
        h: 0.45,
        rectRadius: 0.08,
        fill: { color: '1E293B' }
      });
      slide.addText(`TEAM:  ${p.team_name.toUpperCase()}`, {
        x: 6.35,
        y: 2.45,
        w: 5.7,
        h: 0.45,
        fontSize: 11,
        bold: true,
        color: '38BDF8',
        fontFace: 'Arial',
        align: 'left'
      });
    }

    // Grid of specs
    const gridStartY = p.team_name ? 3.1 : 2.65;

    // Spec Box 1: Batting Style
    slide.addShape(pptx.ShapeType.roundRect, {
      x: 6.2,
      y: gridStartY,
      w: 6.0,
      h: 0.8,
      rectRadius: 0.1,
      fill: { color: '131D31' },
      line: { color: '1E293B', width: 1 }
    });
    slide.addText('BATTING STYLE', {
      x: 6.4,
      y: gridStartY + 0.08,
      w: 5.6,
      h: 0.25,
      fontSize: 9,
      bold: true,
      color: '64748B',
      fontFace: 'Arial'
    });
    slide.addText(battingText, {
      x: 6.4,
      y: gridStartY + 0.32,
      w: 5.6,
      h: 0.4,
      fontSize: 14,
      bold: true,
      color: 'F1F5F9',
      fontFace: 'Arial'
    });

    // Spec Box 2: Bowling Style
    slide.addShape(pptx.ShapeType.roundRect, {
      x: 6.2,
      y: gridStartY + 0.95,
      w: 6.0,
      h: 0.8,
      rectRadius: 0.1,
      fill: { color: '131D31' },
      line: { color: '1E293B', width: 1 }
    });
    slide.addText('BOWLING STYLE', {
      x: 6.4,
      y: gridStartY + 0.95 + 0.08,
      w: 5.6,
      h: 0.25,
      fontSize: 9,
      bold: true,
      color: '64748B',
      fontFace: 'Arial'
    });
    slide.addText(bowlingText, {
      x: 6.4,
      y: gridStartY + 0.95 + 0.32,
      w: 5.6,
      h: 0.4,
      fontSize: 14,
      bold: true,
      color: 'F1F5F9',
      fontFace: 'Arial'
    });

    // Spec Box 3: Jersey Details (Side by side)
    const jerseyY = gridStartY + 1.9;
    // Jersey Number
    slide.addShape(pptx.ShapeType.roundRect, {
      x: 6.2,
      y: jerseyY,
      w: 2.85,
      h: 0.8,
      rectRadius: 0.1,
      fill: { color: '131D31' },
      line: { color: '1E293B', width: 1 }
    });
    slide.addText('JERSEY NUMBER', {
      x: 6.4,
      y: jerseyY + 0.08,
      w: 2.45,
      h: 0.25,
      fontSize: 9,
      bold: true,
      color: '64748B',
      fontFace: 'Arial'
    });
    slide.addText(jerseyNum, {
      x: 6.4,
      y: jerseyY + 0.32,
      w: 2.45,
      h: 0.4,
      fontSize: 16,
      bold: true,
      color: 'F59E0B',
      fontFace: 'Arial'
    });

    // Jersey Size
    slide.addShape(pptx.ShapeType.roundRect, {
      x: 9.35,
      y: jerseyY,
      w: 2.85,
      h: 0.8,
      rectRadius: 0.1,
      fill: { color: '131D31' },
      line: { color: '1E293B', width: 1 }
    });
    slide.addText('JERSEY SIZE', {
      x: 9.55,
      y: jerseyY + 0.08,
      w: 2.45,
      h: 0.25,
      fontSize: 9,
      bold: true,
      color: '64748B',
      fontFace: 'Arial'
    });
    slide.addText(jerseySize, {
      x: 9.55,
      y: jerseyY + 0.32,
      w: 2.45,
      h: 0.4,
      fontSize: 14,
      bold: true,
      color: 'F1F5F9',
      fontFace: 'Arial'
    });

    // Bottom watermark
    slide.addText('FRIENDS PREMIER LEAGUE · OFFICIAL ROSTER', {
      x: 6.2,
      y: 6.35,
      w: 6.0,
      h: 0.3,
      fontSize: 9,
      color: '475569',
      fontFace: 'Arial',
      align: 'right',
      charSpacing: 1
    });

    if (playerIndex % 20 === 0 || playerIndex === allPlayers.length) {
      console.log(`Generated ${playerIndex}/${allPlayers.length} player slides...`);
    }
  }

  // 6. Write final PowerPoint presentation
  const outputFileName = 'FPL_Clash_of_Champions_100_Players.pptx';
  const outputPath = resolve(process.cwd(), outputFileName);
  console.log(`Writing presentation to disk: ${outputPath}...`);
  await pptx.writeFile({ fileName: outputPath });
  console.log(`🎉 SUCCESS: Created 101-slide PowerPoint at: ${outputPath}`);
}

generatePowerPoint().catch(err => {
  console.error('Error generating PowerPoint:', err);
  process.exit(1);
});
