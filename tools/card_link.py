#!/usr/bin/env python3
"""스터디 프로모션 '링크로 카드 가져오기' 링크 만들기 (v3.5, 형식: js/cardlink.js · README)

카드를 한 줄에 한 장씩 '앞면<TAB>뒷면'으로 넣으면 링크를 찍는다.
JSON도 된다: [["앞","뒤"], ...] 또는 {"deck": "덱 이름", "cards": [["앞","뒤"], ...]}

  printf 'hola\t안녕\nadiós\t잘 가\n' | python3 tools/card_link.py --deck "스페인어 1과"
  python3 tools/card_link.py --deck "스페인어 1과" cards.tsv
  python3 tools/card_link.py --zip cards.json      # 아주 긴 목록: 압축 링크

기본은 '글자 그대로' 링크다. 한글·악센트는 그대로 두고 꼭 필요한 글자만 %로 바꾸므로
링크가 읽기 쉽고, AI가 대화창에 옮겨 적어도 틀리기 어렵다.
"""
import argparse
import base64
import json
import re
import sys
import zlib

HOME = 'https://mjleo6278-thecreater.github.io/studypromotion/'
SPECIAL = set('%&#+~()<>"\\[]^`{|}')  # js/cardlink.js enc()와 같아야 한다


def clean(s):
    return re.sub(r'\s+', ' ', str(s)).strip()


def enc(s):
    return ''.join('%%%02X' % ord(ch) if ch in SPECIAL else ch for ch in clean(s)).replace(' ', '+')


def build(cards, deck='', base=HOME):
    url = base + '#cards'
    if deck:
        url += '&deck=' + enc(deck)
    return url + ''.join('&c=' + enc(f) + '~' + enc(b) for f, b in cards)


def build_zip(cards, deck='', base=HOME):
    raw = json.dumps({'deck': deck or '', 'cards': [[f, b] for f, b in cards]}, ensure_ascii=False, separators=(',', ':'))
    co = zlib.compressobj(9, zlib.DEFLATED, -15)  # deflate-raw
    z = co.compress(raw.encode('utf-8')) + co.flush()
    return base + '#cards&z=' + base64.urlsafe_b64encode(z).decode('ascii').rstrip('=')


def parse(text):
    """입력 글 → (deck, [(앞, 뒤), ...])"""
    t = text.strip()
    if t.startswith('[') or t.startswith('{'):
        data = json.loads(t)
        deck = data.get('deck', '') if isinstance(data, dict) else ''
        items = data.get('cards', []) if isinstance(data, dict) else data
        cards = []
        for c in items:
            if isinstance(c, dict):
                cards.append((c.get('front', ''), c.get('back', '')))
            else:
                cards.append((c[0], c[1]))
        return deck, cards
    cards = []
    for line in text.splitlines():
        if not line.strip():
            continue
        if '\t' in line:
            f, b = line.split('\t', 1)
        elif ' - ' in line:
            f, b = line.split(' - ', 1)
        else:
            print('건너뜀 (앞면과 뒷면을 탭으로 나눠 주세요): ' + line, file=sys.stderr)
            continue
        cards.append((f, b))
    return '', cards


def main():
    ap = argparse.ArgumentParser(description='스터디 프로모션 카드 링크 만들기')
    ap.add_argument('file', nargs='?', help='카드 파일 (없으면 표준 입력)')
    ap.add_argument('--deck', default=None, help='덱 이름')
    ap.add_argument('--zip', action='store_true', help='압축 링크로 (아주 긴 목록)')
    ap.add_argument('--base', default=HOME, help='앱 주소 (시험용)')
    a = ap.parse_args()
    text = open(a.file, encoding='utf-8').read() if a.file else sys.stdin.read()
    deck, cards = parse(text)
    cards = [(clean(f), clean(b)) for f, b in cards if clean(f) and clean(b)]
    if a.deck is not None:
        deck = a.deck
    if not cards:
        sys.exit('카드가 없어요')
    url = (build_zip if a.zip else build)(cards, deck, a.base)
    print('카드 %d장' % len(cards), file=sys.stderr)
    print(url)


if __name__ == '__main__':
    main()
