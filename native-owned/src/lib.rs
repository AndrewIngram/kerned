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
// [glyph_id, UTF16_cluster, x_advance_bits, x_offset_bits, y_offset_bits], then UTF16 breaks.
#[unsafe(no_mangle)]
pub extern "C" fn shape(font_id: usize, ptr: *mut u8, len: usize) -> *const u32 {
    let bytes = unsafe { consume(ptr, len) };
    let Ok(text) = std::str::from_utf8(&bytes) else {
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
        buffer.guess_segment_properties();
        buffer.set_direction(harfrust::Direction::LeftToRight);
        let shaped = shaper.shape(buffer, &[]);
        let mut offsets = vec![0u32; text.len() + 1];
        let mut units = 0;
        for (byte, ch) in text.char_indices() {
            offsets[byte] = units;
            units += ch.len_utf16() as u32;
        }
        offsets[text.len()] = units;
        let breaks: Vec<u32> = unicode_linebreak::linebreaks(text)
            .map(|(byte, _)| offsets[byte])
            .collect();
        state.result.clear();
        state
            .result
            .extend([shaped.len() as u32, breaks.len() as u32, font.upem as u32]);
        for (info, pos) in shaped.glyph_infos().iter().zip(shaped.glyph_positions()) {
            state.result.extend([
                info.glyph_id,
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
