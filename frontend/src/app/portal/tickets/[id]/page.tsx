import { redirect } from 'next/navigation';
export default function PortalTicketDetailRedirect({ params }: { params: { id: string } }) {
  redirect(`/portal/dashboard/tickets/${params.id}`);
}
