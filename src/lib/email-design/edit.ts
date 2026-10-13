import {
  MAX_BLOCKS,
  MAX_COLUMN_BLOCKS,
  type Block,
  type ColumnChild,
  type ColumnsBlock,
  type DesignStyles,
  type EmailDesign,
  type FooterBlock,
} from "./schema";

// Pure editing operations for the visual editor. Each returns a new design
// (or the same object when nothing changes) and keeps the invariant that the
// footer exists once, in last place: it can't be moved, duplicated or deleted
// and nothing can be placed after it.

type ContentBlock = Exclude<Block, FooterBlock>;

function footerIndex(design: EmailDesign): number {
  const index = design.blocks.findIndex((block) => block.type === "footer");
  return index === -1 ? design.blocks.length : index;
}

function withBlocks(design: EmailDesign, blocks: Block[]): EmailDesign {
  return { ...design, blocks };
}

export function findBlock(design: EmailDesign, id: string | null | undefined): Block | undefined {
  return id ? design.blocks.find((block) => block.id === id) : undefined;
}

/** Every id in use, including blocks inside columns. */
export function collectIds(design: EmailDesign): Set<string> {
  const ids = new Set<string>();
  for (const block of design.blocks) {
    ids.add(block.id);
    if (block.type === "columns") {
      for (const column of block.columns) for (const child of column.blocks) ids.add(child.id);
    }
  }
  return ids;
}

/** A block id that isn't used in the design yet. `random` is injectable for tests. */
export function newBlockId(design: EmailDesign, random: () => number = Math.random): string {
  const used = collectIds(design);
  for (;;) {
    const candidate = `b${Math.floor(random() * 36 ** 6)
      .toString(36)
      .padStart(6, "0")}`;
    if (!used.has(candidate)) return candidate;
  }
}

export function canAddBlock(design: EmailDesign): boolean {
  return design.blocks.length < MAX_BLOCKS;
}

/**
 * Insert a block after the block `afterId`, or at the end of the content
 * (just above the footer) when `afterId` is missing, unknown or the footer.
 */
export function addBlock(design: EmailDesign, block: ContentBlock, afterId?: string | null): EmailDesign {
  if (!canAddBlock(design) || collectIds(design).has(block.id)) return design;
  const end = footerIndex(design);
  const after = afterId ? design.blocks.findIndex((b) => b.id === afterId) : -1;
  const at = after === -1 || after >= end ? end : after + 1;
  return withBlocks(design, [...design.blocks.slice(0, at), block, ...design.blocks.slice(at)]);
}

/** Replace the block with the same id. The block type can't change. */
export function replaceBlock(design: EmailDesign, block: Block): EmailDesign {
  const index = design.blocks.findIndex((b) => b.id === block.id);
  if (index === -1 || design.blocks[index].type !== block.type || design.blocks[index] === block) return design;
  const blocks = design.blocks.slice();
  blocks[index] = block;
  return withBlocks(design, blocks);
}

/** Move a block to `toIndex` (its position in the list once it has been taken out). Clamped above the footer. */
export function moveBlockTo(design: EmailDesign, id: string, toIndex: number): EmailDesign {
  const from = design.blocks.findIndex((block) => block.id === id);
  if (from === -1 || design.blocks[from].type === "footer") return design;
  const last = footerIndex(design) - 1;
  const to = Math.min(last, Math.max(0, Math.trunc(toIndex)));
  if (!Number.isFinite(to) || to === from) return design;
  const blocks = design.blocks.slice();
  const [moved] = blocks.splice(from, 1);
  blocks.splice(to, 0, moved);
  return withBlocks(design, blocks);
}

/**
 * Drag and drop: the `toIndex` for moveBlockTo() when the block at
 * `fromIndex` is dropped just before / after the block at `overIndex`.
 */
export function dropIndex(fromIndex: number, overIndex: number, position: "before" | "after"): number {
  const insertAt = position === "before" ? overIndex : overIndex + 1;
  return fromIndex < insertAt ? insertAt - 1 : insertAt;
}

export function canMoveBlock(design: EmailDesign, id: string, direction: -1 | 1): boolean {
  const from = design.blocks.findIndex((block) => block.id === id);
  if (from === -1 || design.blocks[from].type === "footer") return false;
  const to = from + direction;
  return to >= 0 && to < footerIndex(design);
}

/** Move a block one place up (-1) or down (1). */
export function moveBlock(design: EmailDesign, id: string, direction: -1 | 1): EmailDesign {
  if (!canMoveBlock(design, id, direction)) return design;
  return moveBlockTo(design, id, design.blocks.findIndex((block) => block.id === id) + direction);
}

/**
 * Copy a block and insert the copy right below it. The copy gets the id
 * `newId`; blocks inside copied columns get ids derived from it.
 */
export function duplicateBlock(design: EmailDesign, id: string, newId: string): EmailDesign {
  const original = findBlock(design, id);
  if (!original || original.type === "footer") return design;
  let copy: ContentBlock;
  if (original.type === "columns") {
    let n = 0;
    const [left, right] = original.columns.map((column) => ({
      blocks: column.blocks.map((child) => ({ ...child, id: `${newId}-${++n}` })),
    }));
    copy = { ...original, id: newId, columns: [left, right] };
  } else {
    copy = { ...original, id: newId };
  }
  return addBlock(design, copy, id);
}

export function canDeleteBlock(design: EmailDesign, id: string): boolean {
  const block = findBlock(design, id);
  return block !== undefined && block.type !== "footer";
}

export function deleteBlock(design: EmailDesign, id: string): EmailDesign {
  if (!canDeleteBlock(design, id)) return design;
  return withBlocks(
    design,
    design.blocks.filter((block) => block.id !== id),
  );
}

export function updateStyles(design: EmailDesign, patch: Partial<DesignStyles>): EmailDesign {
  return { ...design, styles: { ...design.styles, ...patch } };
}

// ---------------------------------------------------------------------------
// Blocks inside a "two columns" block
// ---------------------------------------------------------------------------

export type ColumnIndex = 0 | 1;

function withColumn(block: ColumnsBlock, column: ColumnIndex, blocks: ColumnChild[]): ColumnsBlock {
  const columns: ColumnsBlock["columns"] = [block.columns[0], block.columns[1]];
  columns[column] = { ...block.columns[column], blocks };
  return { ...block, columns };
}

export function canAddColumnChild(block: ColumnsBlock, column: ColumnIndex): boolean {
  return block.columns[column].blocks.length < MAX_COLUMN_BLOCKS;
}

export function addColumnChild(block: ColumnsBlock, column: ColumnIndex, child: ColumnChild): ColumnsBlock {
  if (!canAddColumnChild(block, column)) return block;
  return withColumn(block, column, [...block.columns[column].blocks, child]);
}

export function replaceColumnChild(block: ColumnsBlock, column: ColumnIndex, child: ColumnChild): ColumnsBlock {
  const current = block.columns[column].blocks;
  const index = current.findIndex((c) => c.id === child.id);
  if (index === -1 || current[index].type !== child.type) return block;
  const blocks = current.slice();
  blocks[index] = child;
  return withColumn(block, column, blocks);
}

export function moveColumnChild(
  block: ColumnsBlock,
  column: ColumnIndex,
  childId: string,
  direction: -1 | 1,
): ColumnsBlock {
  const current = block.columns[column].blocks;
  const from = current.findIndex((c) => c.id === childId);
  const to = from + direction;
  if (from === -1 || to < 0 || to >= current.length) return block;
  const blocks = current.slice();
  [blocks[from], blocks[to]] = [blocks[to], blocks[from]];
  return withColumn(block, column, blocks);
}

export function deleteColumnChild(block: ColumnsBlock, column: ColumnIndex, childId: string): ColumnsBlock {
  const current = block.columns[column].blocks;
  if (!current.some((c) => c.id === childId)) return block;
  return withColumn(
    block,
    column,
    current.filter((c) => c.id !== childId),
  );
}

// ---------------------------------------------------------------------------
// Editor state: the design plus which block is selected
// ---------------------------------------------------------------------------

export interface EditorState {
  design: EmailDesign;
  /** Block whose properties are shown; null = none. */
  selectedId: string | null;
}

export type EditorAction =
  | { type: "select"; id: string | null }
  | { type: "add"; block: ContentBlock; afterId?: string | null }
  | { type: "replace"; block: Block }
  | { type: "move"; id: string; direction: -1 | 1 }
  | { type: "moveTo"; id: string; toIndex: number }
  | { type: "duplicate"; id: string; newId: string }
  | { type: "delete"; id: string }
  | { type: "styles"; patch: Partial<DesignStyles> };

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  const { design } = state;
  switch (action.type) {
    case "select":
      return action.id === null || findBlock(design, action.id) ? { ...state, selectedId: action.id } : state;
    case "add": {
      const next = addBlock(design, action.block, action.afterId);
      return next === design ? state : { design: next, selectedId: action.block.id };
    }
    case "replace": {
      const next = replaceBlock(design, action.block);
      return next === design ? state : { ...state, design: next };
    }
    case "move": {
      const next = moveBlock(design, action.id, action.direction);
      return next === design ? state : { ...state, design: next };
    }
    case "moveTo": {
      const next = moveBlockTo(design, action.id, action.toIndex);
      return next === design ? state : { ...state, design: next };
    }
    case "duplicate": {
      const next = duplicateBlock(design, action.id, action.newId);
      return next === design ? state : { design: next, selectedId: action.newId };
    }
    case "delete": {
      const index = design.blocks.findIndex((block) => block.id === action.id);
      const next = deleteBlock(design, action.id);
      if (next === design) return state;
      if (state.selectedId !== action.id) return { ...state, design: next };
      // Keep a selection: the block that took the deleted one's place, else the one above.
      const neighbour = next.blocks[index]?.type === "footer" ? next.blocks[index - 1] : next.blocks[index];
      return { design: next, selectedId: neighbour?.id ?? null };
    }
    case "styles":
      return { ...state, design: updateStyles(design, action.patch) };
  }
}
