// Browser layout adapter for the disposable engine comparison.
// JavaScript owns the document. This instance caches only derived paragraph layouts.
use parley::{
    Affinity, Alignment, AlignmentOptions, BoundingBox, Cursor, FontContext, FontFamily, FontStyle,
    FontWeight, Layout, LayoutContext, LineHeight, PositionedLayoutItem, Selection, StyleProperty,
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{cell::RefCell, collections::HashMap};

#[link(wasm_import_module = "env")]
unsafe extern "C" {
    fn now() -> f64;
    fn log_error(ptr: *const u8, len: usize);
}

#[derive(Deserialize)]
struct Span {
    start: usize,
    end: usize,
    bold: bool,
    italic: bool,
}

#[derive(Deserialize)]
#[serde(tag = "op", rename_all = "camelCase")]
enum Request {
    Layout {
        id: u32,
        text: String,
        spans: Vec<Span>,
        width: f32,
        size: f32,
    },
    Hit {
        id: u32,
        x: f32,
        y: f32,
    },
    Geometry {
        id: u32,
        anchor: usize,
        focus: usize,
        upstream: bool,
    },
    Move {
        id: u32,
        index: usize,
        upstream: bool,
        direction: String,
    },
    Clear,
}

#[derive(Serialize)]
struct DrawRun {
    font: usize,
    size: f32,
    glyphs: Vec<u32>,
    positions: Vec<f32>,
}

struct Paragraph {
    text: String,
    layout: Layout<[u8; 4]>,
}
struct Engine {
    fonts: FontContext,
    context: LayoutContext<[u8; 4]>,
    font_ids: Vec<u64>,
    paragraphs: HashMap<u32, Paragraph>,
    response: Vec<u8>,
}
impl Default for Engine {
    fn default() -> Self {
        Self {
            fonts: FontContext::new(),
            context: LayoutContext::new(),
            font_ids: vec![],
            paragraphs: HashMap::new(),
            response: vec![],
        }
    }
}
thread_local! { static ENGINE: RefCell<Engine> = RefCell::new(Engine::default()); }

// The JS bridge allocates an input slice, fills it, and passes it to exactly one consuming export.
#[unsafe(no_mangle)]
pub extern "C" fn allocate(len: usize) -> *mut u8 {
    Box::into_raw(vec![0_u8; len].into_boxed_slice()) as *mut u8
}
unsafe fn consume(ptr: *mut u8, len: usize) -> Box<[u8]> {
    unsafe { Box::from_raw(std::ptr::slice_from_raw_parts_mut(ptr, len)) }
}
#[unsafe(no_mangle)]
pub extern "C" fn install_panic_hook() {
    std::panic::set_hook(Box::new(|info| {
        let message = info.to_string();
        unsafe {
            log_error(message.as_ptr(), message.len());
        }
    }));
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn register_font(ptr: *mut u8, len: usize) -> u32 {
    let bytes = unsafe { consume(ptr, len) };
    ENGINE.with_borrow_mut(|engine| {
        let blob: parley::fontique::Blob<u8> = Vec::from(bytes).into();
        let blob_id = blob.id();
        let families = engine.fonts.collection.register_fonts(blob, None);
        if families.is_empty() {
            return u32::MAX;
        }
        let index = engine.font_ids.len() as u32;
        engine.font_ids.push(blob_id);
        index
    })
}

fn byte_offset(text: &str, utf16: usize) -> usize {
    let mut units = 0;
    for (byte, ch) in text.char_indices() {
        if units >= utf16 {
            return byte;
        }
        units += ch.len_utf16();
    }
    text.len()
}
fn utf16_offset(text: &str, byte: usize) -> usize {
    text[..byte.min(text.len())].encode_utf16().count()
}
fn rect(r: BoundingBox) -> [f64; 4] {
    [r.x0, r.y0, r.x1, r.y1]
}
fn affinity(upstream: bool) -> Affinity {
    if upstream {
        Affinity::Upstream
    } else {
        Affinity::Downstream
    }
}
fn position(p: &Paragraph, cursor: Cursor) -> Value {
    json!({"index":utf16_offset(&p.text,cursor.index()),"upstream":cursor.affinity()==Affinity::Upstream})
}

impl Engine {
    fn execute(&mut self, request: Request) -> Result<Value, String> {
        match request {
            Request::Layout {
                id,
                text,
                spans,
                width,
                size,
            } => {
                if !width.is_finite() || width <= 0. || !size.is_finite() || size <= 0. {
                    return Err("Invalid layout dimensions".into());
                }
                let start = unsafe { now() };
                let mut builder = self
                    .context
                    .ranged_builder(&mut self.fonts, &text, 1., false);
                builder.push_default(FontFamily::from("Noto Sans, Noto Sans Arabic, Noto Sans Hebrew, Noto Sans Devanagari, Noto Sans CJK JP, Noto Color Emoji"));
                builder.push_default(StyleProperty::FontSize(size));
                builder.push_default(LineHeight::Absolute(size * 1.6));
                builder.push_default(StyleProperty::Brush([37, 42, 35, 255]));
                for span in spans {
                    let range = byte_offset(&text, span.start)..byte_offset(&text, span.end);
                    if span.bold {
                        builder.push(
                            StyleProperty::FontWeight(FontWeight::new(700.)),
                            range.clone(),
                        );
                    }
                    if span.italic {
                        builder.push(StyleProperty::FontStyle(FontStyle::Italic), range);
                    }
                }
                let mut layout = builder.build(&text);
                layout.break_all_lines(Some(width));
                layout.align(Alignment::Start, AlignmentOptions::default());
                let core_ms = unsafe { now() } - start;
                let mut runs = vec![];
                let mut missing = 0;
                let mut lines = vec![];
                for line in layout.lines() {
                    let m = line.metrics();
                    let range = line.text_range();
                    lines.push(json!({"start":utf16_offset(&text,range.start),"end":utf16_offset(&text,range.end),"top":m.block_min_coord,"bottom":m.block_max_coord,"baseline":m.baseline,"width":m.advance}));
                    for item in line.items() {
                        if let PositionedLayoutItem::GlyphRun(run) = item {
                            let font = self
                                .font_ids
                                .iter()
                                .position(|id| *id == run.run().font().data.id())
                                .ok_or("Unknown font in Parley run")?;
                            let mut out = DrawRun {
                                font,
                                size: run.run().font_size(),
                                glyphs: vec![],
                                positions: vec![],
                            };
                            for g in run.positioned_glyphs() {
                                if g.id == 0 {
                                    missing += 1;
                                }
                                out.glyphs.push(g.id);
                                out.positions.extend([g.x, g.y]);
                            }
                            runs.push(out);
                        }
                    }
                }
                let result = json!({"height":layout.height(),"lines":lines,"runs":runs,"coreMs":core_ms,"missing":missing});
                self.paragraphs.insert(id, Paragraph { text, layout });
                Ok(result)
            }
            Request::Hit { id, x, y } => {
                let p = self.paragraphs.get(&id).ok_or("Unknown paragraph")?;
                Ok(position(p, Cursor::from_point(&p.layout, x, y)))
            }
            Request::Geometry {
                id,
                anchor,
                focus,
                upstream,
            } => {
                let p = self.paragraphs.get(&id).ok_or("Unknown paragraph")?;
                let a = Cursor::from_byte_index(
                    &p.layout,
                    byte_offset(&p.text, anchor),
                    Affinity::Downstream,
                );
                let f = Cursor::from_byte_index(
                    &p.layout,
                    byte_offset(&p.text, focus),
                    affinity(upstream),
                );
                let selection = Selection::new(a, f);
                Ok(
                    json!({"caret":rect(f.geometry(&p.layout,1.5)),"rects":selection.geometry(&p.layout).into_iter().map(|(r,_)|rect(r)).collect::<Vec<_>>()}),
                )
            }
            Request::Move {
                id,
                index,
                upstream,
                direction,
            } => {
                let p = self.paragraphs.get(&id).ok_or("Unknown paragraph")?;
                let cursor = Cursor::from_byte_index(
                    &p.layout,
                    byte_offset(&p.text, index),
                    affinity(upstream),
                );
                let s = Selection::new(cursor, cursor);
                let cursor = match direction.as_str() {
                    "left" => cursor.previous_visual(&p.layout),
                    "right" => cursor.next_visual(&p.layout),
                    "up" => s.previous_line(&p.layout, false).focus(),
                    "down" => s.next_line(&p.layout, false).focus(),
                    "home" => s.line_start(&p.layout, false).focus(),
                    "end" => s.line_end(&p.layout, false).focus(),
                    _ => return Err("Unknown movement".into()),
                };
                Ok(position(p, cursor))
            }
            Request::Clear => {
                self.paragraphs.clear();
                Ok(json!(null))
            }
        }
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn request(ptr: *mut u8, len: usize) -> *const u8 {
    let bytes = unsafe { consume(ptr, len) };
    ENGINE.with_borrow_mut(|engine| {
        let result = serde_json::from_slice::<Request>(&bytes)
            .map_err(|e| e.to_string())
            .and_then(|r| engine.execute(r));
        engine.response = serde_json::to_vec(&match result {
            Ok(value) => value,
            Err(error) => json!({"error":error}),
        })
        .unwrap();
        engine.response.as_ptr()
    })
}
#[unsafe(no_mangle)]
pub extern "C" fn response_len() -> usize {
    ENGINE.with_borrow(|engine| engine.response.len())
}
