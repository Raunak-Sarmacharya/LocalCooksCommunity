type ProgressIndicatorProps = {
  step: 1 | 2 | 3 | 4;
};

export default function ProgressIndicator({ step }: ProgressIndicatorProps) {
  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex justify-between items-center">
        <div className="w-1/3 relative">
          <div className="h-2 bg-primary rounded-l-full progress-glow"></div>
          <div className="absolute -top-2 left-0 w-6 h-6 rounded-full bg-primary flex items-center justify-center text-white font-bold progress-glow">
            1
          </div>
          <p className="absolute -top-10 left-0 text-sm font-semibold text-primary">
            Personal Info
          </p>
        </div>
        
        <div className="w-1/3 relative">
          <div className={`h-2 ${step >= 2 ? 'bg-primary progress-glow' : 'bg-gray-300'}`}></div>
          <div 
            className={`absolute -top-2 left-1/2 transform -translate-x-1/2 w-6 h-6 rounded-full ${
              step >= 2 ? 'bg-primary progress-glow' : 'bg-gray-300'
            } flex items-center justify-center text-white font-bold`}
          >
            2
          </div>
          <p className={`absolute -top-10 left-1/2 transform -translate-x-1/2 text-sm font-semibold text-center ${
            step >= 2 ? 'text-primary' : 'text-gray-500'
          }`}>
            Kitchen
          </p>
        </div>
        
        <div className="w-1/3 relative">
          <div className={`h-2 ${step >= 3 ? 'bg-primary progress-glow' : 'bg-gray-300'} rounded-r-full`}></div>
          <div 
            className={`absolute -top-2 right-0 w-6 h-6 rounded-full ${
              step >= 3 ? 'bg-primary progress-glow' : 'bg-gray-300'
            } flex items-center justify-center text-white font-bold`}
          >
            3
          </div>
          <p className={`absolute -top-10 right-0 text-sm font-semibold ${
            step >= 3 ? 'text-primary' : 'text-gray-500'
          }`}>
            Certifications
          </p>
        </div>
      </div>
    </div>
  );
}
