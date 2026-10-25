import React from 'react';
import { DeploymentStatus } from '@shipyard/shared';
import { Check, Clock, Cpu, Server, X } from 'lucide-react';

interface DeploymentStepperProps {
  status: DeploymentStatus;
  errorMessage?: string | null;
}

export function DeploymentStepper({ status, errorMessage }: DeploymentStepperProps) {
  const steps = [
    {
      id: 'queued',
      label: 'Queued',
      description: 'Job enqueued in BullMQ',
      icon: Clock,
      isDone: status !== DeploymentStatus.QUEUED,
      isActive: status === DeploymentStatus.QUEUED,
      isError: false,
    },
    {
      id: 'building',
      label: 'Building',
      description: 'Docker image build with CFS quotas',
      icon: Cpu,
      isDone: status === DeploymentStatus.DEPLOYING || status === DeploymentStatus.SUCCESS,
      isActive: status === DeploymentStatus.BUILDING,
      isError: status === DeploymentStatus.FAILED && !status,
    },
    {
      id: 'deploying',
      label: 'Deploying',
      description: 'Health probes & Traefik atomic cutover',
      icon: Server,
      isDone: status === DeploymentStatus.SUCCESS,
      isActive: status === DeploymentStatus.DEPLOYING,
      isError: false,
    },
    {
      id: 'live',
      label: status === DeploymentStatus.FAILED ? 'Failed' : 'Live Traffic',
      description:
        status === DeploymentStatus.SUCCESS
          ? 'Serving on Traefik edge router'
          : status === DeploymentStatus.FAILED
          ? errorMessage || 'Deployment pipeline failed'
          : 'Zero-downtime cutover target',
      icon: status === DeploymentStatus.FAILED ? X : Check,
      isDone: status === DeploymentStatus.SUCCESS,
      isActive: false,
      isError: status === DeploymentStatus.FAILED,
    },
  ];

  return (
    <div className="w-full rounded-xl border border-slate-800 bg-slate-900/60 p-4 sm:p-6 backdrop-blur-md">
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 relative">
        {steps.map((step, idx) => {
          const Icon = step.icon;

          return (
            <div key={step.id} className="relative flex flex-col items-start sm:items-center text-left sm:text-center">
              {/* Connector line on desktop */}
              {idx < steps.length - 1 && (
                <div
                  className={`hidden sm:block absolute top-4 left-1/2 w-full h-[2px] transition-colors ${
                    step.isDone ? 'bg-blue-500/80' : 'bg-slate-800'
                  }`}
                  style={{ zIndex: 0 }}
                />
              )}

              {/* Step Circle */}
              <div
                className={`relative z-10 flex h-9 w-9 items-center justify-center rounded-full border text-xs font-semibold transition-all ${
                  step.isError
                    ? 'border-rose-500 bg-rose-500/20 text-rose-400 shadow-lg shadow-rose-500/20'
                    : step.isDone
                    ? 'border-blue-500 bg-blue-600 text-white shadow-lg shadow-blue-500/20'
                    : step.isActive
                    ? 'border-amber-400 bg-amber-400/20 text-amber-300 ring-4 ring-amber-400/10 animate-pulse'
                    : 'border-slate-800 bg-slate-950 text-slate-500'
                }`}
              >
                {step.isDone ? <Check className="h-4 w-4 stroke-[3]" /> : <Icon className="h-4 w-4" />}
              </div>

              {/* Text */}
              <div className="mt-2.5">
                <span
                  className={`block text-xs font-semibold ${
                    step.isError
                      ? 'text-rose-400'
                      : step.isDone
                      ? 'text-slate-200'
                      : step.isActive
                      ? 'text-amber-300'
                      : 'text-slate-500'
                  }`}
                >
                  {step.label}
                </span>
                <span className="block text-[11px] text-slate-400 mt-0.5 max-w-[160px] line-clamp-2">
                  {step.description}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
