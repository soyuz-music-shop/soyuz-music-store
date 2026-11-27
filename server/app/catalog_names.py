"""Display-only artist/title parsing, ported from the M331 audited browser parser."""
import re

FORMAT = re.compile(r'^(?:\d*\s*(?:LP|CD|MC|DVD|BD|SACD|Blu[ -]?ray|EP|SP)(?=$|[\s/+,.\d-]|jewel|digi|card|box)|компакт[ -]?диск|аудиокассета|винил|книга|диск\b|бокс[ -]?сет|(?:белая|черная|цветная|красная|прозрачная) кассета)', re.I)
CONFIRMED = ('Forward Russia!', 'Где Фантом?', 'Пахом Вам Перезвонит', 'Blind Guardian Twilight Orchestra', 'AIR French Band', 'Herman Frank', 'Nagart', 'Телевизор', 'Katatonia', 'Lord Of The Lost', 'Лаэртский и Карабас', 'А. Ф. Скляр и Ва-Банкъ', 'W.A.S.P.', 'S.Y.P.H.')

def tidy(v):
    return ' '.join(v.split()) if isinstance(v, str) else ''

def artist_key(v):
    return tidy(v).lower().replace('\u0451', '\u0435')

def display_name(name, artist=None):
    body, details = tidy(name), ''
    while body.endswith(')'):
        depth = 0
        for i in range(len(body)-1, -1, -1):
            if body[i] == ')': depth += 1
            elif body[i] == '(':
                depth -= 1
                if depth == 0: break
        if i <= 0 or not FORMAT.match(body[i+1:-1].strip()): break
        details = ' '.join(filter(None, (body[i:], details)))
        body = body[:i].rstrip()
    hints = sorted(filter(None, map(tidy, (*(artist or '').split(' · '), *CONFIRMED))), key=len, reverse=True)
    parts, depth = [], 0
    for i, ch in enumerate(body):
        if ch == '(':
            depth += 1; continue
        if ch == ')':
            depth = max(0, depth-1); continue
        if depth: continue
        left = body[:i].rstrip()
        after = body[i+1:i+2]
        if ch == '.' and after.isspace() and left and (not left.endswith('.') or (re.search(r'(?:[^\W\d_]\.){2,}$', left) and not left.endswith('..'))) and not re.fullmatch(r'[.\s]*', left) and not re.search(r'(?:^|\s)(?:[^\W\d_]|Dr|Mr|Mrs|Ms|St|DJ|MC|Vol|No|Op|Pt|ч|им)$', left, re.I) and not re.search(r'(?:^|\s)(?:[^\W\d_]\.)+[^\W\d_]$', left):
            parts.append((i, i+1, 'dot'))
        elif ch in '—–-' and i > 0 and body[i-1].isspace() and after.isspace():
            parts.append((i, i+1, 'dash'))
    def split(i,j,reason):
        return dict(artist=body[:i].strip(), title=body[j:].strip(), details=details, reason=reason)
    dot = next((p for p in parts if p[2]=='dot'), None)
    for hint in hints:
        if not artist_key(body).startswith(artist_key(hint)): continue
        rest=body[len(hint):]
        if not rest: return dict(artist=body,title='',details=details,reason='artist_only')
        explicit=re.match(r'^(?:\s*\.\s*|\s*[—–-]\s*)',rest)
        if explicit and rest[explicit.end():].strip() and not re.match(r'^\.{2,}',rest.lstrip()):
            return split(len(hint),len(hint)+explicit.end(),'hint_delimiter')
        if rest[0].isspace() and rest.strip() and not re.match(r'^(?:и|and|with|feat\.?|featuring|&|\+|/|\()',rest.lstrip(),re.I):
            if not dot or (dot[0]>=len(hint) and not re.match(r'^(?:[^.]*\s)?(?:&|\band\b|\bfeat\b|\bи\b)\s',body[len(hint):dot[0]].strip(),re.I)):
                return split(len(hint),len(hint),'hint_space')
    if details.lower().startswith('(книга') and not dot:
        dash=next((p for p in parts if p[2]=='dash'),None)
        if dash and body[dash[1]:].strip(): return split(dash[0],dash[1],'book_dash')
    compilation=re.fullmatch(r'(?:разные исполнители|various(?: artists)?)',tidy(artist),re.I) and not re.match(r'^various\.\s',body,re.I)
    if dot and not compilation and body[dot[1]:].strip(): return split(dot[0],dot[1],'dot')
    return dict(artist=body,title='',details=details,reason='unsplit')

def filter_artist(display):
    # An unseparated title might be a compilation or soundtrack, not an artist.
    return display['artist'] if display['reason'] != 'unsplit' else ''
