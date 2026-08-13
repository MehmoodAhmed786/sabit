import logo from '../assets/logo.png'

type LogoProps = {
  className?: string
  alt?: string
}

export default function Logo({ className, alt = 'Sabit' }: LogoProps) {
  return <img src={logo} alt={alt} className={className} />
}

export { logo as logoUrl }
