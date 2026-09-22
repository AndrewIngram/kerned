// Narrow shaping boundary. Paragraph composition and editor geometry live in TS.
use harfrust::{FontRef, ShaperData, UnicodeBuffer};
use read_fonts::TableProvider;
use std::cell::RefCell;
struct Font {
    bytes: Vec<u8>,
    data: ShaperData,
    upem: u16,
}
#[derive(Default)]
struct State {
    fonts: Vec<Font>,
    result: Vec<u32>,
}
thread_local! { static STATE: RefCell<State> = RefCell::new(State::default()); }
#[unsafe(no_mangle)]
pub extern "C" fn allocate(len: usize) -> *mut u8 {
    Box::into_raw(vec![0u8; len].into_boxed_slice()) as *mut u8
}
unsafe fn consume(ptr: *mut u8, len: usize) -> Vec<u8> {
    unsafe { Box::from_raw(std::ptr::slice_from_raw_parts_mut(ptr, len)).into_vec() }
}
#[unsafe(no_mangle)]
pub extern "C" fn register_font(ptr: *mut u8, len: usize) -> u32 {
    let bytes = unsafe { consume(ptr, len) };
    let Ok(font) = FontRef::new(&bytes) else {
        return u32::MAX;
    };
    let Ok(head) = font.head() else {
        return u32::MAX;
    };
    let upem = head.units_per_em();
    let data = ShaperData::new(&font);
    STATE.with_borrow_mut(|state| {
        let id = state.fonts.len() as u32;
        state.fonts.push(Font { bytes, data, upem });
        id
    })
}
// Result: [glyph_count, break_count, units_per_em], then 5 words per glyph:
// [glyph_id | unsafe_to_break<<31, UTF16_cluster, x_advance_bits, x_offset_bits,
// y_offset_bits], then UTF16 breaks. Glyph IDs occupy the low 16 bits.
#[unsafe(no_mangle)]
pub extern "C" fn shape(font_id: usize, ptr: *mut u8, len: usize) -> *const u32 {
    shape_run(font_id, ptr, len, 0, len, 0, 0)
}
// The selected UTF-8 byte range is shaped with its surrounding paragraph as
// joining context. Results remain local UTF-16 offsets, exactly like shape().
#[unsafe(no_mangle)]
pub extern "C" fn shape_run(
    font_id: usize,
    ptr: *mut u8,
    len: usize,
    start: usize,
    end: usize,
    rtl: u32,
    script: u32,
) -> *const u32 {
    let result = shape_slice(font_id, ptr, len, start, end, rtl, script);
    unsafe { consume(ptr, len) };
    result
}
#[unsafe(no_mangle)]
pub extern "C" fn release_text(ptr: *mut u8, len: usize) -> u32 {
    unsafe { consume(ptr, len) };
    0
}
// Paragraph-level UAX 14 opportunities without shaping a redundant whole run.
#[unsafe(no_mangle)]
pub extern "C" fn line_breaks(ptr: *const u8, len: usize) -> *const u32 {
    let bytes = unsafe { std::slice::from_raw_parts(ptr, len) };
    let Ok(text) = std::str::from_utf8(bytes) else {
        return std::ptr::null();
    };
    STATE.with_borrow_mut(|state| {
        let offsets = utf16_offsets(text);
        state.result.clear();
        state
            .result
            .extend(unicode_linebreak::linebreaks(text).map(|(byte, _)| offsets[byte]));
        state.result.as_ptr()
    })
}
fn utf16_offsets(text: &str) -> Vec<u32> {
    let mut offsets = vec![0u32; text.len() + 1];
    let mut units = 0;
    for (byte, ch) in text.char_indices() {
        offsets[byte] = units;
        units += ch.len_utf16() as u32;
    }
    offsets[text.len()] = units;
    offsets
}
// Borrow a paragraph uploaded once for all of its style/script/font runs.
#[unsafe(no_mangle)]
pub extern "C" fn shape_slice(
    font_id: usize,
    ptr: *mut u8,
    len: usize,
    start: usize,
    end: usize,
    rtl: u32,
    script: u32,
) -> *const u32 {
    let bytes = unsafe { std::slice::from_raw_parts(ptr, len) };
    let Ok(paragraph) = std::str::from_utf8(&bytes) else {
        return std::ptr::null();
    };
    let Some(text) = paragraph.get(start..end) else {
        return std::ptr::null();
    };
    STATE.with_borrow_mut(|state| {
        let Some(font) = state.fonts.get(font_id) else {
            return std::ptr::null();
        };
        let face = FontRef::new(&font.bytes).unwrap();
        let shaper = font.data.shaper(&face).build();
        let mut buffer = UnicodeBuffer::new();
        buffer.push_str(text);
        buffer.set_pre_context(&paragraph[..start]);
        buffer.set_post_context(&paragraph[end..]);
        buffer.guess_segment_properties();
        if script != 0 {
            if let Some(value) =
                harfrust::Script::from_iso15924_tag(harfrust::Tag::new(&script.to_be_bytes()))
            {
                buffer.set_script(value);
            }
        }
        buffer.set_direction(if rtl == 0 {
            harfrust::Direction::LeftToRight
        } else {
            harfrust::Direction::RightToLeft
        });
        let shaped = shaper.shape(buffer, &[]);
        let offsets = utf16_offsets(text);
        let breaks: Vec<u32> = unicode_linebreak::linebreaks(text)
            .map(|(byte, _)| offsets[byte])
            .collect();
        state.result.clear();
        state
            .result
            .extend([shaped.len() as u32, breaks.len() as u32, font.upem as u32]);
        for (info, pos) in shaped.glyph_infos().iter().zip(shaped.glyph_positions()) {
            state.result.extend([
                info.glyph_id
                    | if info.unsafe_to_break() {
                        0x80000000
                    } else {
                        0
                    },
                offsets[info.cluster as usize],
                (pos.x_advance as f32).to_bits(),
                (pos.x_offset as f32).to_bits(),
                (pos.y_offset as f32).to_bits(),
            ]);
        }
        state.result.extend(breaks);
        state.result.as_ptr()
    })
}
#[unsafe(no_mangle)]
pub extern "C" fn result_words() -> usize {
    STATE.with_borrow(|state| state.result.len())
}
