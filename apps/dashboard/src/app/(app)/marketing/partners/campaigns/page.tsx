import { redirect } from 'next/navigation';

/** The campaigns list lives on the partners page as a tab. */
export default function PartnerCampaignsIndex() {
  redirect('/marketing/partners?view=campaigns');
}
