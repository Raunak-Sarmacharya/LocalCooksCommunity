import { Clock, Check, BookOpen } from "lucide-react";

interface BookingKPIStatsProps {
    bookings: any[];
}

export default function BookingKPIStats({ bookings }: BookingKPIStatsProps) {
    const pendingBookings = bookings.filter((b: any) => b.status === "pending");
    const confirmedBookings = bookings.filter((b: any) => b.status === "confirmed");

    return (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-6 md:p-8 hover:shadow-xl transition-all duration-300">
                <div className="flex items-center justify-between">
                    <div>
                        <p className="text-sm font-medium text-gray-600">Pending Review</p>
                        <p className="text-3xl font-bold text-gray-900 mt-1">{pendingBookings.length}</p>
                    </div>
                    <div className="p-3 bg-yellow-100 rounded-full">
                        <Clock className="h-6 w-6 text-yellow-600" />
                    </div>
                </div>
            </div>

            <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-6 md:p-8 hover:shadow-xl transition-all duration-300">
                <div className="flex items-center justify-between">
                    <div>
                        <p className="text-sm font-medium text-gray-600">Confirmed</p>
                        <p className="text-3xl font-bold text-gray-900 mt-1">{confirmedBookings.length}</p>
                    </div>
                    <div className="p-3 bg-green-100 rounded-full">
                        <Check className="h-6 w-6 text-green-600" />
                    </div>
                </div>
            </div>

            <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-6 md:p-8 hover:shadow-xl transition-all duration-300">
                <div className="flex items-center justify-between">
                    <div>
                        <p className="text-sm font-medium text-gray-600">Total Bookings</p>
                        <p className="text-3xl font-bold text-gray-900 mt-1">{bookings.length}</p>
                    </div>
                    <div className="p-3 bg-blue-100 rounded-full">
                        <BookOpen className="h-6 w-6 text-blue-600" />
                    </div>
                </div>
            </div>
        </div>
    );
}
