import * as React from "react"
import { Send, Paperclip, X } from "lucide-react"
import { useForm } from "react-hook-form"
import { z } from "zod"
import { zodResolver } from "@hookform/resolvers/zod"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import {
  Form,
  FormControl,
  FormField,
  FormItem,
} from "@/components/ui/form"
import { cn } from "@/lib/utils"

const ChatInputSchema = z.object({
  message: z.string().min(1, "Message cannot be empty"),
})

type ChatInputFormType = z.infer<typeof ChatInputSchema>

interface ChatInputProps {
  onSend: (message: string, files?: File[]) => void
  onFileSelect?: (files: File[]) => void
  disabled?: boolean
  isLoading?: boolean
  placeholder?: string
  className?: string
}

export function ChatInput({ 
  onSend, 
  disabled, 
  isLoading, 
  placeholder = "Type your message...",
  className 
}: ChatInputProps) {
  const [files, setFiles] = React.useState<File[]>([])
  const fileInputRef = React.useRef<HTMLInputElement>(null)

  const form = useForm<ChatInputFormType>({
    resolver: zodResolver(ChatInputSchema),
    defaultValues: {
      message: "",
    },
  })

  const message = form.watch("message")

  const onSubmit = async (data: ChatInputFormType) => {
    if ((!data.message.trim() && files.length === 0) || disabled || isLoading) return
    
    // We handle the submission manually to allow clearing logic
    // Currently standardizing on array of files
    if (files.length > 0) {
        // If we have files, we might need to send them one by one or as list depending on parent
        // For now, let's assume onSend handles it. 
        // We'll update interface to allow File[] but for now cast to any to avoid breaking changes immediately if strict.
        // Actually, let's fix the interface above.
        onSend(data.message, files as any)
    } else {
        onSend(data.message)
    }
    
    // Reset form and file
    form.reset()
    setFiles([])
    if (fileInputRef.current) fileInputRef.current.value = ""
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      form.handleSubmit(onSubmit)()
    }
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const newFiles = Array.from(e.target.files)
      setFiles(prev => [...prev, ...newFiles])
      // onFileSelect is legacy singular, maybe call it for the first one or remove usage?
      // onFileSelect?.(selectedFile) 
    }
  }

  const removeFile = (indexToRemove: number) => {
      setFiles(prev => prev.filter((_, index) => index !== indexToRemove))
      // Clear input if empty so change event fires again for same file
      if (files.length <= 1 && fileInputRef.current) {
          fileInputRef.current.value = ""
      }
  }

  return (
    <div className={cn("p-4 border-t bg-background", className)}>
      {files.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-2 animate-in fade-in slide-in-from-bottom-2">
          {files.map((file, index) => (
             <div key={index} className="flex items-center gap-2 p-2 bg-muted rounded-md w-fit">
                <span className="text-sm truncate max-w-[200px]">{file.name}</span>
                <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-4 w-4 rounded-full hover:bg-destructive/10 hover:text-destructive"
                    onClick={() => removeFile(index)}
                >
                    <X className="h-3 w-3" />
                </Button>
            </div>
          ))}
        </div>
      )}
      
      <Form {...form}>
        <form
          onSubmit={form.handleSubmit(onSubmit)}
          className="flex items-end gap-2"
        >
          <input
            type="file"
            className="hidden"
            multiple // Allow multiple
            ref={fileInputRef}
            onChange={handleFileChange}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-[40px] w-[40px] shrink-0"
            onClick={() => fileInputRef.current?.click()}
            disabled={disabled || isLoading}
          >
            <Paperclip className="h-5 w-5 text-muted-foreground" />
          </Button>

          <FormField
            control={form.control}
            name="message"
            render={({ field }) => (
              <FormItem className="flex-1 space-y-0">
                <FormControl>
                  <Textarea
                    {...field}
                    placeholder={placeholder}
                    onKeyDown={handleKeyDown}
                    className="min-h-[40px] max-h-[200px] resize-none py-3 bg-muted/50 focus:bg-background transition-colors"
                    disabled={disabled || isLoading}
                    rows={1}
                    autoComplete="off"
                  />
                </FormControl>
              </FormItem>
            )}
          />

          <Button
            type="submit"
            disabled={disabled || isLoading || (!message.trim() && files.length === 0)}
            size="icon"
            className="h-[40px] w-[40px] shrink-0 transition-all duration-200"
          >
            {isLoading ? (
               <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
            ) : (
               <Send className="h-5 w-5 ml-0.5" />
            )}
          </Button>
        </form>
      </Form>
    </div>
  )
}
