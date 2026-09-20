#!/usr/bin/env python3
"""Convert the supplied, unencrypted Warbreaker PRC to portable semantic HTML.

Uses only Python's standard library. Supports PalmDOC compression, Windows-1252
and UTF-8 MOBI text without record trailers. Does not decrypt ebooks.
"""
import argparse
from collections import Counter
from dataclasses import dataclass, field
from hashlib import sha256
from html import escape
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import struct
from urllib.parse import urlsplit


def decompress(data):
    output = bytearray()
    cursor = 0
    while cursor < len(data):
        code = data[cursor]
        cursor += 1
        if 1 <= code <= 8:
            if cursor + code > len(data):
                raise ValueError('Truncated PalmDOC literal')
            output.extend(data[cursor:cursor + code])
            cursor += code
        elif code < 128:
            output.append(code)
        elif code >= 192:
            output.extend((32, code ^ 128))
        else:
            if cursor == len(data):
                raise ValueError('Truncated PalmDOC reference')
            pair = (code << 8) | data[cursor]
            cursor += 1
            distance = (pair & 0x3fff) >> 3
            if not 0 < distance <= len(output):
                raise ValueError('Invalid PalmDOC reference')
            for _ in range((pair & 7) + 3):
                output.append(output[-distance])
    return bytes(output)


def extract(data):
    if len(data) < 86 or data[60:68] != b'BOOKMOBI':
        raise ValueError('Expected a Mobipocket Palm database')
    count = struct.unpack_from('>H', data, 76)[0]
    if len(data) < 78 + count * 8 or count < 2:
        raise ValueError('Invalid record directory')
    offsets = [struct.unpack_from('>I', data, 78 + i * 8)[0] for i in range(count)] + [len(data)]
    if offsets[0] < 78 + count * 8 or any(a >= b for a, b in zip(offsets, offsets[1:])):
        raise ValueError('Invalid record offsets')
    header = data[offsets[0]:offsets[1]]
    if len(header) < 244 or header[16:20] != b'MOBI':
        raise ValueError('Unsupported MOBI header')
    compression, _, length, records, _, encryption, _ = struct.unpack_from('>HHIHHHH', header)
    if encryption:
        raise ValueError('Encrypted books are not supported')
    if compression not in (1, 2) or header[242:244] != b'\0\0':
        raise ValueError('Unsupported compression or record trailers')
    if not 0 < records < count:
        raise ValueError('Invalid text record count')
    encoding = {1252: 'cp1252', 65001: 'utf-8'}.get(struct.unpack_from('>I', header, 28)[0])
    if encoding is None:
        raise ValueError('Unsupported text encoding')
    chunks = [data[offsets[i]:offsets[i + 1]] for i in range(1, records + 1)]
    raw = b''.join(decompress(chunk) if compression == 2 else chunk for chunk in chunks)
    if len(raw) != length:
        raise ValueError(f'Decoded {len(raw)} bytes; expected {length}')
    return raw.decode(encoding), encoding


@dataclass
class Element:
    tag: str
    attrs: dict = field(default_factory=dict)
    children: list = field(default_factory=list)


class Tree(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.root = Element('root')
        self.stack = [self.root]

    def handle_starttag(self, tag, attrs):
        element = Element(tag, dict(attrs))
        self.stack[-1].children.append(element)
        if tag not in ('br', 'mbp:pagebreak', 'meta', 'link'):
            self.stack.append(element)

    def handle_endtag(self, tag):
        for i in range(len(self.stack) - 1, 0, -1):
            if self.stack[i].tag == tag:
                del self.stack[i:]
                return

    def handle_data(self, data):
        self.stack[-1].children.append(data)


def elements(node):
    if isinstance(node, Element):
        yield node
        for child in node.children:
            yield from elements(child)


def text(node):
    if isinstance(node, str):
        return node
    return '\n' if node.tag == 'br' else ''.join(text(child) for child in node.children)


def normalized(value):
    return re.sub(r'\s+', ' ', value).strip()


def normalize_inline(node):
    """Collapse manuscript indentation and spacing across inline tag boundaries."""
    leaves = []
    def visit(element):
        for index, child in enumerate(element.children):
            if isinstance(child, str):
                leaves.append((element, index))
            elif child.tag == 'br':
                leaves.append((element, index))
            else:
                visit(child)
    visit(node)
    whitespace = True
    for parent, index in leaves:
        child = parent.children[index]
        if isinstance(child, Element):
            whitespace = True
        else:
            value = re.sub(r'\s+', ' ', child)
            if whitespace:
                value = value.lstrip(' ')
            parent.children[index] = value
            if value:
                whitespace = value.endswith(' ')
    # Remove leading/trailing empty lines used as page layout, not prose.
    for sequence in (leaves, reversed(leaves)):
        for parent, index in sequence:
            child = parent.children[index]
            if isinstance(child, Element):
                parent.children[index] = ''
            else:
                value = child.lstrip() if sequence is leaves else child.rstrip()
                parent.children[index] = value
                if value:
                    break


BLOCKS = {'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'}
TAGS = BLOCKS | {'strong', 'em', 'u', 'sup', 'sub', 'a', 'br', 'table', 'tr', 'td', 'th'}


def serialize(node):
    if isinstance(node, str):
        return escape(node)
    if node.tag in ('head', 'mbp:pagebreak'):
        return ''
    tag = {'b': 'strong', 'i': 'em'}.get(node.tag, node.tag)
    inner = ''.join(serialize(child) for child in node.children)
    if tag not in TAGS:
        return inner
    if tag == 'br':
        return '<br>'
    if not text(node).strip():
        return ''
    attrs = ''
    if tag == 'a':
        href = node.attrs.get('href', '')
        if urlsplit(href).scheme.lower() not in ('https', 'http', 'mailto'):
            raise ValueError('Unexpected link scheme')
        attrs = f' href="{escape(href, quote=True)}"'
    if tag in BLOCKS and node.attrs.get('align') == 'center':
        attrs += ' style="text-align: center"'
    if tag.startswith('h') and tag in BLOCKS:
        slug = re.sub(r'[^a-z0-9]+', '-', text(node).strip().lower()).strip('-')
        attrs += f' id="{node.attrs["heading_index"]}-{slug}"'
    return f'<{tag}{attrs}>{inner}</{tag}>' + ('\n' if tag in BLOCKS | {'table', 'tr'} else '')


def convert(source, destination):
    data = source.read_bytes()
    html, encoding = extract(data)
    tree = Tree()
    tree.feed(html)
    body = next(node for node in elements(tree.root) if node.tag == 'body')
    original_blocks = [normalized(text(node)) for node in elements(body) if node.tag in BLOCKS and normalized(text(node))]
    original_text = re.sub(r'\s', '', text(body))
    heading_index = 0
    for node in elements(body):
        if node.tag in BLOCKS:
            normalize_inline(node)
            if node.tag != 'p':
                heading_index += 1
                node.attrs['heading_index'] = f'section-{heading_index}'
    content = serialize(body)
    result = '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n' + \
        '<meta name="viewport" content="width=device-width, initial-scale=1">\n' + \
        '<title>Warbreaker (6.1) — Brandon Sanderson</title>\n<meta name="author" content="Brandon Sanderson">\n' + \
        '<style>body{max-width:44rem;margin:3rem auto;padding:0 1.5rem;font:1.15rem/1.65 Georgia,serif}h1,h2{line-height:1.25;margin-top:2.5em}table{border-collapse:collapse;width:100%}td,th{padding:.5em;text-align:left;vertical-align:top;border-bottom:1px solid #ccc}a{overflow-wrap:anywhere}</style>\n' + \
        '</head>\n<body>\n' + content.strip() + '\n</body>\n</html>\n'
    verification = Tree()
    verification.feed(result)
    output_body = next(node for node in elements(verification.root) if node.tag == 'body')
    output_blocks = [normalized(text(node)) for node in elements(output_body) if node.tag in BLOCKS]
    if original_blocks != output_blocks or original_text != re.sub(r'\s', '', text(output_body)):
        raise ValueError('Conversion changed the text or paragraph order')
    counts = Counter(node.tag for node in elements(output_body))
    report = {
        'title': 'Warbreaker', 'author': 'Brandon Sanderson', 'version': '6.1',
        'source': source.name, 'sourceSha256': sha256(data).hexdigest(),
        'sourceEncoding': encoding, 'htmlSha256': sha256(result.encode()).hexdigest(),
        'blocks': len(output_blocks), 'headings': heading_index,
        'words': len(' '.join(output_blocks).split()), 'elements': dict(sorted(counts.items())),
        'textVerified': True,
        'contents': 'Complete supplied file, including introduction, rights, revisions and sample chapters of other books.',
        'normalization': 'Whitespace, indentation and empty layout paragraphs removed; pagebreak markers removed; b/i converted to strong/em. Text, underline, links and table cells preserved.',
    }
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(result, encoding='utf-8')
    destination.with_suffix('.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(report, indent=2))


def verify_sample(full_path, sample_path):
    """Refresh metadata for an existing trimmed sample without rewriting its HTML."""
    def read_body(path):
        tree = Tree()
        tree.feed(path.read_text(encoding='utf-8'))
        return next(node for node in elements(tree.root) if node.tag == 'body')
    full, sample = read_body(full_path), read_body(sample_path)
    full_blocks = [normalized(text(node)) for node in elements(full) if node.tag in BLOCKS]
    sample_blocks = [normalized(text(node)) for node in elements(sample) if node.tag in BLOCKS]
    if not sample_blocks:
        raise ValueError('Empty sample')
    starts = [i for i, value in enumerate(full_blocks) if value == sample_blocks[0]]
    start = next((i for i in starts if full_blocks[i:i + len(sample_blocks)] == sample_blocks), None)
    if start is None:
        raise ValueError('Sample is not an unchanged contiguous section of the complete book')
    report = json.loads(full_path.with_suffix('.json').read_text())
    counts = Counter(node.tag for node in elements(sample))
    report.update({
        'htmlSha256': sha256(sample_path.read_bytes()).hexdigest(),
        'blocks': len(sample_blocks), 'headings': sum(counts[tag] for tag in BLOCKS if tag != 'p'),
        'words': len(' '.join(sample_blocks).split()), 'elements': dict(sorted(counts.items())),
        'fullHtml': full_path.name, 'sourceBlockStart': start, 'sourceBlockEnd': start + len(sample_blocks),
        'contents': 'Trimmed editor sample, Prologue through Ars Arcanum. Complete source, attribution and rights are in ' + full_path.name + '.',
    })
    sample_path.with_suffix('.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print(f'Verified {sample_path}: {len(sample_blocks)} unchanged text blocks from offset {start}')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('--output', type=Path, default=Path('public/samples/warbreaker-full.html'))
    parser.add_argument('--sample', type=Path, help='Verify an existing trimmed sample and refresh its JSON metadata')
    args = parser.parse_args()
    convert(args.source, args.output)
    if args.sample:
        verify_sample(args.output, args.sample)
