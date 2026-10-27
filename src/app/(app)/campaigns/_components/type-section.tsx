import type { Campaign } from "@/db/schema";
import { campaignType } from "@/lib/campaign-types/hooks";
import { typeFormValues } from "@/lib/campaign-types/form";
import type { DesignOption } from "../_lib/compose-data";
import { CURRENT_DESIGN } from "../_lib/starting-points";
import { CampaignTypeOptions } from "./type-options";

/** Server wrapper: the campaign-type section of the compose form (new campaign or draft). */
export function CampaignTypeSection({ campaign, designs }: { campaign?: Campaign; designs: DesignOption[] }) {
  return (
    <CampaignTypeOptions
      lockedType={campaign ? campaignType(campaign) : null}
      values={typeFormValues(campaign)}
      designs={designs.filter((d) => d.value !== CURRENT_DESIGN).map((d) => ({ value: d.value, name: d.name }))}
    />
  );
}
