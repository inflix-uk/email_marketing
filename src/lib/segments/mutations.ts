import { collections } from "@/db";
import { newId } from "@/db/schema";
import type { SegmentInput } from "./rules";

// Writes for the /segments pages. Input is already validated (segmentInputSchema).

export async function createSegment(input: SegmentInput): Promise<string> {
  const { segments } = await collections();
  const id = newId();
  const now = new Date();
  await segments.insertOne({
    _id: id,
    name: input.name,
    description: input.description,
    match: input.match,
    rules: input.rules,
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

/** Returns false when the segment no longer exists. */
export async function updateSegment(id: string, input: SegmentInput): Promise<boolean> {
  const { segments } = await collections();
  const result = await segments.updateOne(
    { _id: id },
    {
      $set: {
        name: input.name,
        description: input.description,
        match: input.match,
        rules: input.rules,
        updatedAt: new Date(),
      },
    },
  );
  return result.matchedCount > 0;
}

/** Delete a segment and take it out of every campaign's audience. Contacts are not touched. */
export async function deleteSegment(id: string): Promise<boolean> {
  const { segments, campaigns } = await collections();
  const deleted = await segments.deleteOne({ _id: id });
  // Clean up references even when the segment was already gone (e.g. a retried delete).
  await campaigns.updateMany({ segmentIds: id }, { $pull: { segmentIds: id }, $set: { updatedAt: new Date() } });
  return deleted.deletedCount > 0;
}
