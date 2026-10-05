import { CalendarApp } from "@/components/calendar/CalendarApp";
import { isDateString, nowInClinic } from "@/lib/domain/time";

export default async function Page({ searchParams }: PageProps<"/">) {
  const { date } = await searchParams;
  const initialDate = typeof date === "string" && isDateString(date) ? date : nowInClinic().date;
  return <CalendarApp initialDate={initialDate} />;
}
