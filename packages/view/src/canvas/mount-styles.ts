export const mountStyles = `[data-editor-view]:has(> [data-editor-input]:focus-visible) {
  outline: 2px solid Highlight;
  outline-offset: -2px;
}
[data-editor-view] [data-editor-node][data-selected='true']::after {
  content: '';
  position: absolute;
  inset: 0;
  background: rgba(194, 216, 235, 0.45);
  outline: 2px solid #8daec9;
  pointer-events: none;
  border-radius: 8px;
}
`;
