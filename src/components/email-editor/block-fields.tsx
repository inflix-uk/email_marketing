"use client";

import Link from "next/link";
import {
  addColumnChild,
  BLOCK_LABELS,
  canAddColumnChild,
  COLUMN_CHILD_TYPES,
  CONTENT_WIDTH,
  createBlock,
  deleteColumnChild,
  FONT_FAMILIES,
  FONT_FAMILY_KEYS,
  IMAGE_WIDTH,
  moveColumnChild,
  replaceColumnChild,
  sanitizeImageUrl,
  SPACER_HEIGHT,
  type Block,
  type ButtonBlock,
  type ColumnChild,
  type ColumnIndex,
  type ColumnsBlock,
  type DesignStyles,
  type FooterBlock,
  type HeadingBlock,
  type ImageBlock,
  type TextBlock,
} from "@/lib/email-design";
import { ArrowDownIcon, ArrowUpIcon, IconButton, PlusIcon, TrashIcon } from "./controls";
import {
  AlignField,
  ChoiceField,
  ColorField,
  FieldRow,
  RangeField,
  RichTextField,
  SelectField,
  TextField,
  UrlField,
} from "./fields";
import { ImagePicker } from "./image-picker";

// The properties form of each block type, and the global "Styles" form.
// Every form is controlled: it receives the block and reports the changed
// block; the design state lives in the visual editor.

interface FieldsProps<T> {
  /** Prefix for element ids, unique per block. */
  idPrefix: string;
  block: T;
  onChange: (block: T) => void;
  styles: DesignStyles;
}

function HeadingFields({ idPrefix, block, onChange }: FieldsProps<HeadingBlock>) {
  return (
    <>
      <TextField
        id={`${idPrefix}-text`}
        label="Heading text"
        value={block.text}
        onChange={(text) => onChange({ ...block, text })}
      />
      <ChoiceField
        label="Size"
        value={block.level}
        onChange={(level) => onChange({ ...block, level })}
        options={[
          { value: 1, label: "Large" },
          { value: 2, label: "Medium" },
          { value: 3, label: "Small" },
        ]}
      />
      <AlignField value={block.align} onChange={(align) => onChange({ ...block, align })} />
    </>
  );
}

function TextFields({ idPrefix, block, onChange, styles }: FieldsProps<TextBlock>) {
  return (
    <>
      <RichTextField
        id={`${idPrefix}-text`}
        label="Text"
        value={block.text}
        onChange={(text) => onChange({ ...block, text })}
      />
      <ChoiceField
        label="Text size"
        value={block.size}
        onChange={(size) => onChange({ ...block, size })}
        options={[
          { value: "small", label: "Small" },
          { value: "normal", label: "Normal" },
          { value: "large", label: "Large" },
        ]}
      />
      <AlignField value={block.align} onChange={(align) => onChange({ ...block, align })} />
      <ColorField
        id={`${idPrefix}-color`}
        label="Text colour"
        value={block.color}
        onChange={(color) => onChange({ ...block, color })}
        fallback={{
          color: styles.textColor,
          label: "Use default",
          onReset: () => onChange({ ...block, color: null }),
        }}
      />
    </>
  );
}

function ImageFields({ idPrefix, block, onChange }: FieldsProps<ImageBlock>) {
  const src = sanitizeImageUrl(block.src);
  const unusable = block.src.trim() !== "" && !src;
  return (
    <>
      {src ? (
        <div className="flex items-center gap-3 rounded-md bg-slate-50 p-2 ring-1 ring-slate-200 ring-inset">
          {/* eslint-disable-next-line @next/next/no-img-element -- arbitrary external or uploaded image */}
          <img src={src} alt="" className="h-14 w-14 shrink-0 rounded bg-white object-contain ring-1 ring-slate-200" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs text-slate-600" title={src}>
              {src}
            </p>
            <button
              type="button"
              onClick={() => onChange({ ...block, src: "" })}
              className="mt-0.5 rounded text-xs font-medium text-red-600 hover:text-red-500 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-indigo-600"
            >
              Remove image
            </button>
          </div>
        </div>
      ) : null}

      <ImagePicker value={block.src} onPick={(url) => onChange({ ...block, src: url })} />

      <FieldRow
        label="Image address"
        htmlFor={`${idPrefix}-src`}
        hint="Filled in when you upload or pick an image. You can also paste the address of an image hosted elsewhere."
        warning={unusable ? "Use a full address starting with https:// - this image will be left out." : undefined}
      >
        <input
          id={`${idPrefix}-src`}
          value={block.src}
          onChange={(e) => onChange({ ...block, src: e.target.value })}
          placeholder="https://example.com/image.png"
          maxLength={2000}
          inputMode="url"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          aria-invalid={unusable || undefined}
          className="block w-full rounded-md border-0 bg-white px-2.5 py-1.5 text-sm text-slate-900 shadow-sm ring-1 ring-slate-300 ring-inset placeholder:text-slate-400 focus:ring-2 focus:ring-indigo-600 focus:ring-inset"
        />
      </FieldRow>

      <TextField
        id={`${idPrefix}-alt`}
        label="Alt text"
        value={block.alt}
        onChange={(alt) => onChange({ ...block, alt })}
        placeholder="Describe the image"
        hint="Shown when images are blocked and read out by screen readers. Leave empty for decorative images."
      />
      <UrlField
        id={`${idPrefix}-link`}
        label="Link (optional)"
        value={block.link}
        onChange={(link) => onChange({ ...block, link })}
        hint="Where a click on the image goes."
      />
      <RangeField
        id={`${idPrefix}-width`}
        label="Width"
        value={block.width}
        onChange={(width) => onChange({ ...block, width })}
        min={IMAGE_WIDTH.min}
        max={IMAGE_WIDTH.max}
        step={IMAGE_WIDTH.step}
        unit="%"
      />
      <AlignField value={block.align} onChange={(align) => onChange({ ...block, align })} />
    </>
  );
}

function ButtonFields({ idPrefix, block, onChange, styles }: FieldsProps<ButtonBlock>) {
  return (
    <>
      <TextField
        id={`${idPrefix}-label`}
        label="Button text"
        value={block.label}
        onChange={(label) => onChange({ ...block, label })}
      />
      <UrlField
        id={`${idPrefix}-url`}
        label="Link"
        value={block.url}
        onChange={(url) => onChange({ ...block, url })}
        hint={block.url.trim() ? undefined : "Without a link the button can't be clicked."}
      />
      <AlignField value={block.align} onChange={(align) => onChange({ ...block, align })} />
      <ColorField
        id={`${idPrefix}-bg`}
        label="Button colour"
        value={block.backgroundColor}
        onChange={(backgroundColor) => onChange({ ...block, backgroundColor })}
        fallback={{
          color: styles.accentColor,
          label: "Use accent colour",
          onReset: () => onChange({ ...block, backgroundColor: null }),
        }}
      />
      <ColorField
        id={`${idPrefix}-fg`}
        label="Text colour"
        value={block.textColor}
        onChange={(textColor) => onChange({ ...block, textColor })}
      />
    </>
  );
}

function FooterFields({ idPrefix, block, onChange }: FieldsProps<FooterBlock>) {
  return (
    <>
      <p className="text-xs text-slate-500">
        Every email ends with your company address and an unsubscribe link, so the footer can&apos;t be removed. The
        address comes from{" "}
        <Link href="/settings" className="font-medium text-indigo-600 hover:text-indigo-500">
          Settings
        </Link>
        .
      </p>
      <RichTextField
        id={`${idPrefix}-text`}
        label="Footer text"
        value={block.text}
        onChange={(text) => onChange({ ...block, text })}
        rows={3}
      />
      <TextField
        id={`${idPrefix}-unsubscribe`}
        label="Unsubscribe link text"
        value={block.unsubscribeLabel}
        onChange={(unsubscribeLabel) => onChange({ ...block, unsubscribeLabel })}
        placeholder="Unsubscribe"
      />
      <ColorField
        id={`${idPrefix}-color`}
        label="Text colour"
        value={block.color}
        onChange={(color) => onChange({ ...block, color })}
      />
    </>
  );
}

const COLUMN_NAMES = ["Left column", "Right column"] as const;

function ColumnsFields({
  idPrefix,
  block,
  onChange,
  styles,
  newId,
}: FieldsProps<ColumnsBlock> & { newId: () => string }) {
  return (
    <>
      <p className="text-xs text-slate-500">Two columns side by side. On phones the right column moves below the left.</p>
      {([0, 1] as ColumnIndex[]).map((column) => {
        const children = block.columns[column].blocks;
        const name = COLUMN_NAMES[column];
        return (
          <fieldset key={column} className="space-y-2">
            <legend className="text-xs font-semibold tracking-wide text-slate-500 uppercase">{name}</legend>
            {children.length === 0 ? <p className="text-xs text-slate-400">Empty - add something below.</p> : null}
            {children.map((child, index) => {
              const label = `${BLOCK_LABELS[child.type]} in the ${name.toLowerCase()}`;
              return (
                <div key={child.id} className="rounded-md bg-white ring-1 ring-slate-200">
                  <div className="flex items-center gap-0.5 border-b border-slate-100 py-0.5 pr-1 pl-2.5">
                    <span className="mr-auto text-xs font-medium text-slate-700">{BLOCK_LABELS[child.type]}</span>
                    <IconButton
                      label={`Move up: ${label}`}
                      disabled={index === 0}
                      onClick={() => onChange(moveColumnChild(block, column, child.id, -1))}
                    >
                      <ArrowUpIcon />
                    </IconButton>
                    <IconButton
                      label={`Move down: ${label}`}
                      disabled={index === children.length - 1}
                      onClick={() => onChange(moveColumnChild(block, column, child.id, 1))}
                    >
                      <ArrowDownIcon />
                    </IconButton>
                    <IconButton
                      label={`Remove: ${label}`}
                      className="hover:text-red-600"
                      onClick={() => onChange(deleteColumnChild(block, column, child.id))}
                    >
                      <TrashIcon />
                    </IconButton>
                  </div>
                  <div className="space-y-3 p-2.5">
                    <ChildFields
                      idPrefix={`${idPrefix}-${child.id}`}
                      block={child}
                      styles={styles}
                      onChange={(next) => onChange(replaceColumnChild(block, column, next))}
                    />
                  </div>
                </div>
              );
            })}
            {canAddColumnChild(block, column) ? (
              <div role="group" aria-label={`Add to the ${name.toLowerCase()}`} className="flex flex-wrap gap-1.5">
                {COLUMN_CHILD_TYPES.map((type) => (
                  <button
                    key={type}
                    type="button"
                    aria-label={`Add ${BLOCK_LABELS[type].toLowerCase()} to the ${name.toLowerCase()}`}
                    onClick={() => onChange(addColumnChild(block, column, createBlock(type, newId())))}
                    className="inline-flex h-7 items-center gap-1 rounded-md bg-white px-2 text-xs font-medium text-slate-700 shadow-sm ring-1 ring-slate-300 ring-inset hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-indigo-600"
                  >
                    <PlusIcon />
                    {BLOCK_LABELS[type]}
                  </button>
                ))}
              </div>
            ) : null}
          </fieldset>
        );
      })}
    </>
  );
}

function ChildFields({ idPrefix, block, onChange, styles }: FieldsProps<ColumnChild>) {
  switch (block.type) {
    case "text":
      return <TextFields idPrefix={idPrefix} block={block} onChange={onChange} styles={styles} />;
    case "image":
      return <ImageFields idPrefix={idPrefix} block={block} onChange={onChange} styles={styles} />;
    case "button":
      return <ButtonFields idPrefix={idPrefix} block={block} onChange={onChange} styles={styles} />;
  }
}

/** The properties form for any block. */
export function BlockFields({
  idPrefix,
  block,
  onChange,
  styles,
  newId,
}: FieldsProps<Block> & {
  /** A fresh block id (for blocks added inside columns). */
  newId: () => string;
}) {
  switch (block.type) {
    case "heading":
      return <HeadingFields idPrefix={idPrefix} block={block} onChange={onChange} styles={styles} />;
    case "text":
      return <TextFields idPrefix={idPrefix} block={block} onChange={onChange} styles={styles} />;
    case "image":
      return <ImageFields idPrefix={idPrefix} block={block} onChange={onChange} styles={styles} />;
    case "button":
      return <ButtonFields idPrefix={idPrefix} block={block} onChange={onChange} styles={styles} />;
    case "divider":
      return (
        <ColorField
          id={`${idPrefix}-color`}
          label="Line colour"
          value={block.color}
          onChange={(color) => onChange({ ...block, color })}
        />
      );
    case "spacer":
      return (
        <RangeField
          id={`${idPrefix}-height`}
          label="Height"
          value={block.height}
          onChange={(height) => onChange({ ...block, height })}
          min={SPACER_HEIGHT.min}
          max={SPACER_HEIGHT.max}
          step={SPACER_HEIGHT.step}
          unit="px"
        />
      );
    case "columns":
      return <ColumnsFields idPrefix={idPrefix} block={block} onChange={onChange} styles={styles} newId={newId} />;
    case "footer":
      return <FooterFields idPrefix={idPrefix} block={block} onChange={onChange} styles={styles} />;
  }
}

/** The "Styles" tab: settings that apply to the whole email. */
export function StylesFields({
  idPrefix,
  styles,
  onChange,
}: {
  idPrefix: string;
  styles: DesignStyles;
  onChange: (patch: Partial<DesignStyles>) => void;
}) {
  return (
    <div className="space-y-3">
      <SelectField
        id={`${idPrefix}-font`}
        label="Font"
        value={styles.fontFamily}
        onChange={(fontFamily) => onChange({ fontFamily })}
        options={FONT_FAMILY_KEYS.map((key) => ({ value: key, label: FONT_FAMILIES[key].label }))}
      />
      <RangeField
        id={`${idPrefix}-width`}
        label="Content width"
        value={styles.contentWidth}
        onChange={(contentWidth) => onChange({ contentWidth })}
        min={CONTENT_WIDTH.min}
        max={CONTENT_WIDTH.max}
        step={CONTENT_WIDTH.step}
        unit="px"
      />
      <ColorField
        id={`${idPrefix}-page`}
        label="Page background"
        value={styles.pageBackground}
        onChange={(pageBackground) => onChange({ pageBackground })}
      />
      <ColorField
        id={`${idPrefix}-content`}
        label="Content background"
        value={styles.contentBackground}
        onChange={(contentBackground) => onChange({ contentBackground })}
      />
      <ColorField
        id={`${idPrefix}-heading`}
        label="Heading colour"
        value={styles.headingColor}
        onChange={(headingColor) => onChange({ headingColor })}
      />
      <ColorField
        id={`${idPrefix}-text`}
        label="Text colour"
        value={styles.textColor}
        onChange={(textColor) => onChange({ textColor })}
      />
      <ColorField
        id={`${idPrefix}-accent`}
        label="Accent colour"
        value={styles.accentColor}
        onChange={(accentColor) => onChange({ accentColor })}
      />
      <p className="text-xs text-slate-500">
        The accent colour is used for links and buttons. Fonts are limited to ones every mail app has.
      </p>
    </div>
  );
}
