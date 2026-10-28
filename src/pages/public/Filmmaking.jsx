import React from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '../../components/Icon.jsx';
import { Callout, CTASection, FeatureCard, PageHero, Section, StepList } from '../../components/Marketing.jsx';

const tools = [
  { icon: 'clapperboard', title: 'Shorts, films and series', description: 'Choose a format for a short drama, a longer film, or an episodic series and keep the production organized in one workspace.' },
  { icon: 'pen-line', title: 'Scripts and story bibles', description: 'Develop a story, organize scenes and dialogue, and keep the creative direction available as your project evolves.' },
  { icon: 'users', title: 'Recurring characters', description: 'Build a cast with descriptions and visual references to help maintain continuity across scenes and episodes.' },
  { icon: 'wand-sparkles', title: 'Scene-by-scene generation', description: 'Generate individual clips with a configured AI video provider, review the results and regenerate the scenes that need work.' },
  { icon: 'mic2', title: 'Voice and audio', description: 'Bring narration, dialogue, music and subtitles together as part of your production workflow.' },
  { icon: 'scissors', title: 'Edit and assemble', description: 'Arrange scenes and assemble available clips into a downloadable film, with progress and errors visible along the way.' },
];
const steps = [
  { icon: 'target', title: 'Shape the idea', description: 'Choose a format, genre and style, then develop the story and characters.' },
  { icon: 'pen-line', title: 'Plan the scenes', description: 'Build a screenplay and break your production into manageable scenes.' },
  { icon: 'film', title: 'Create and review', description: 'Generate clips with a configured provider and refine individual scenes.' },
  { icon: 'scissors', title: 'Assemble and export', description: 'Bring your clips and audio together and export the finished production.' },
];

export default function Filmmaking() {
  return <>
    <PageHero eyebrow="AI filmmaking studio" title="Bring your stories to life, one scene at a time." description="From your first idea to an assembled film, keep your script, characters, scenes and production assets together in a workspace built for the creative process." actions={<><Link to="/app/films" className="btn btn-primary btn-lg">Explore Film Studio <Icon name="arrow-right" size={16} /></Link><Link to="/docs" className="btn btn-secondary btn-lg">Read the documentation</Link></>} />
    <Section eyebrow="A complete creative workspace" title="Tools for every stage of your production" description="Create short dramas, longer films and series with a workflow designed around review and iteration."><div className="marketing-grid grid-3">{tools.map((tool) => <FeatureCard key={tool.title} {...tool} />)}</div></Section>
    <Section className="section-alt" eyebrow="The process" title="From concept to finished cut" align="center"><StepList steps={steps} /></Section>
    <Section eyebrow="Transparent by design" title="Real tools, clear requirements" description="Long-form productions are built from individual clips, not promised as a single instant generation.">
      <div className="three-up-grid"><div className="number-panel"><span>01</span><h3>Work at your pace</h3><p>Projects and scenes are saved so you can return to your production and refine individual parts.</p></div><div className="number-panel"><span>02</span><h3>Choose a provider</h3><p>AI video generation requires a configured supported provider and its credentials. Availability and costs depend on the provider.</p></div><div className="number-panel"><span>03</span><h3>Stay in control</h3><p>Review scenes, see generation status and credit estimates, and decide what makes the final cut.</p></div></div>
      <Callout icon="info" title="Getting started">Film scene generation requires a configured AI video provider; it is not simulated in local mode. Visit the documentation for setup details.</Callout>
    </Section>
    <CTASection title="Ready to start your next story?" description="Create an account to explore the filmmaking workspace and set up the providers your production needs." primary={{ to: '/app/films', label: 'Open Film Studio' }} secondary={{ to: '/contact', label: 'Contact us' }} />
  </>;
}
