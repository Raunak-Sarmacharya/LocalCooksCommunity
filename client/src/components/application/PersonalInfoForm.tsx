import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useApplicationForm } from "./ApplicationFormContext";

import { Form } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";

// Create a schema for just the personal info fields
const personalInfoSchema = z.object({
  fullName: z.string().min(2, "Full name is required"),
  email: z.string().email("Please enter a valid email address"),
  phone: z.string().min(10, "Please enter a valid phone number"),
  address: z.string().min(5, "Address is required"),
});

type PersonalInfoFormData = z.infer<typeof personalInfoSchema>;

export default function PersonalInfoForm() {
  const { formData, updateFormData, goToNextStep } = useApplicationForm();

  const form = useForm<PersonalInfoFormData>({
    resolver: zodResolver(personalInfoSchema),
    defaultValues: {
      fullName: formData.fullName || "",
      email: formData.email || "",
      phone: formData.phone || "",
      address: formData.address || "",
    },
  });

  const onSubmit = (data: PersonalInfoFormData) => {
    updateFormData(data);
    goToNextStep();
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        <div className="space-y-4">
          <div>
            <Label htmlFor="fullName" className="text-gray-700 font-semibold">
              Full Name*
            </Label>
            <Input
              id="fullName"
              placeholder="Your full name"
              {...form.register("fullName")}
              className="mt-1"
            />
            {form.formState.errors.fullName && (
              <p className="text-primary text-sm mt-1">
                {form.formState.errors.fullName.message}
              </p>
            )}
          </div>

          <div>
            <Label htmlFor="email" className="text-gray-700 font-semibold">
              Email Address*
            </Label>
            <Input
              id="email"
              type="email"
              placeholder="your.email@example.com"
              {...form.register("email")}
              className="mt-1"
            />
            {form.formState.errors.email && (
              <p className="text-primary text-sm mt-1">
                {form.formState.errors.email.message}
              </p>
            )}
          </div>

          <div>
            <Label htmlFor="phone" className="text-gray-700 font-semibold">
              Phone Number*
            </Label>
            <Input
              id="phone"
              placeholder="(555) 123-4567"
              {...form.register("phone")}
              className="mt-1"
            />
            {form.formState.errors.phone && (
              <p className="text-primary text-sm mt-1">
                {form.formState.errors.phone.message}
              </p>
            )}
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="address">Your Address*</Label>
          <Input
            id="address"
            placeholder="Enter your address"
            {...form.register("address")}
          />
          {form.formState.errors.address && (
            <p className="text-sm text-red-500">{form.formState.errors.address.message}</p>
          )}
        </div>

        <div className="text-center">
          <Button
            type="submit"
            className="bg-primary hover:bg-opacity-90 text-white font-bold py-3 px-8 rounded-full shadow-lg transform transition hover:-translate-y-1"
          >
            Continue
          </Button>
        </div>
      </form>
    </Form>
  );
}
