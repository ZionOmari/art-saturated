import { useNavigate, useSearchParams } from 'react-router-dom'
import Footer from '../components/Footer'

function AboutArtSaturated({ navigate }) {
  return (
    <>
      <h1 className="font-serif text-[clamp(2rem,6vw,3.5rem)] font-normal leading-[1.08] mb-10">
        A spot for<br />
        <em className="italic text-earth">real things.</em>
      </h1>

      <hr className="divider mb-10" />

      <div className="text-box-dark font-mono text-[13px] leading-loose space-y-6">
        <p>
          Records, tapes, prints, handmade items. Stuff you can hold, sit with, come back to.{' '}
          <strong className="font-normal">Things that carry time in them.</strong>
        </p>
        <p>
          It is also a place to be.
        </p>
        <p>
          Pull up, play music, talk, work on something, or just exist around other people
          creating. No expectations. No front. Just process.
        </p>
        <p>
          People come through, ideas move, energy builds, things get made.{' '}
          <strong className="font-normal">That is where the culture lives.</strong>
        </p>
        <p>
          Art Saturated holds space for that.
        </p>
        <p>
          That is the mission. Keep physical media in people's hands. Bring people together.
          Let the rest happen how it happens.
        </p>
      </div>

      <hr className="divider my-10" />

      <button className="btn-outline" onClick={() => navigate('/shop')}>
        Browse the Shop
      </button>
    </>
  )
}

function MeetTheArtist() {
  return (
    <>
      <h1 className="font-serif text-[clamp(2rem,6vw,3.5rem)] font-normal leading-[1.08] mb-3">
        Zion Omari
      </h1>
      <p className="eyebrow mb-10 tracking-[0.18em]">Creative Engineer & Artist</p>

      <hr className="divider mb-10" />

      <div className="text-box-dark font-mono text-[13px] leading-loose space-y-6">
        <p>
          Zion Omari is a creative engineer, artist, musician, and dancer who believes that{' '}
          <strong className="font-normal">creativity belongs to everyone.</strong>
        </p>
        <p>
          When Zion was growing up, he didn't always have a lot of art supplies, instructions,
          or clear steps showing him how to become an artist. Sometimes people told him his
          ideas were too big, or that he was trying to do too many things. He was also bullied
          for being different and thinking in his own way.
        </p>
        <p>
          But Zion kept creating anyway.
        </p>
        <p>
          He learned that while it may be true that no one can do everything; we can still do{' '}
          <em>anything</em> if we try hard, stay curious, and refuse to give up.
        </p>
        <p>
          Because art supplies were sometimes hard to get, Zion learned how to create with
          whatever he had; even simple crayons. His main series,{' '}
          <strong className="font-normal">"Crowd Movement,"</strong> is created with
          crayons and ballpoint pen. It explores the idea that when people come together as a
          community, something powerful happens; individual identities begin to blend into
          something bigger; a feeling of connection, unity, and togetherness.
        </p>
        <p>
          Zion's journey has taught him that success does not always come quickly. Sometimes
          the road toward your dreams is the road less traveled. It might feel like walking
          through weeds or stepping into mud; uncomfortable, confusing, and slow.
        </p>
        <p>
          But that's okay.
        </p>
        <p>
          Failure is not the end of the story. It is simply something that happens before success.
        </p>
        <p>
          Through his work, Zion hopes to show creators that you do not need perfect tools,
          lots of money, or someone telling you exactly what to do in order to create something
          meaningful. What you need most is{' '}
          <strong className="font-normal">persistence, imagination, and the courage to keep going.</strong>
        </p>
        <p>
          Zion believes every person has the ability to create something amazing; and if they
          try their hardest, they might surprise even themselves.
        </p>
      </div>

      <hr className="divider my-10" />

      {/* Social links */}
      <div>
        <p className="eyebrow mb-6 tracking-[0.18em]">Follow the Work</p>
        <div className="space-y-0 border-t border-warm-gray-light">
          {[
            { platform: 'YouTube',   handle: '@zionomari.260',    url: 'https://www.youtube.com/@zionomari.260' },
            { platform: 'Instagram', handle: '@zionomarimusic',   url: 'https://www.instagram.com/zionomarimusic/' },
            { platform: 'Instagram', handle: '@zionomariart',     url: 'https://www.instagram.com/zionomariart/' },
            { platform: 'Instagram', handle: '@artsaturated',     url: 'https://www.instagram.com/artsaturated' },
            { platform: 'Instagram', handle: '@zionomaribeats',   url: 'https://www.instagram.com/zionomaribeats' },
            { platform: 'Instagram', handle: '@getontheflora',    url: 'https://www.instagram.com/getontheflora' },
          ].map(({ platform, handle, url }) => (
            <a
              key={handle}
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-between py-4 border-b border-warm-gray-light group"
            >
              <span className="font-mono text-[11px] tracking-[0.1em] uppercase text-warm-gray group-hover:text-ink transition-colors">
                {platform}
              </span>
              <span className="font-mono text-[12px] text-ink group-hover:text-earth transition-colors">
                {handle}
              </span>
            </a>
          ))}
        </div>
      </div>
    </>
  )
}

export default function AboutPage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const tab = searchParams.get('tab') === 'about' ? 'about' : 'artist'
  function setTab(t) { setSearchParams({ tab: t }, { replace: true }) }

  return (
    <main className="pt-[60px]">
      <div className="max-w-xl mx-auto px-6 py-14">

        {/* ── Tabs ── Meet the Artist is primary ─────────────── */}
        <div className="flex gap-2 mb-12">
          <button
            onClick={() => setTab('artist')}
            className={`filter-pill ${tab === 'artist' ? 'filter-pill-active' : ''}`}
          >
            Meet the Artist
          </button>
          <button
            onClick={() => setTab('about')}
            className={`filter-pill ${tab === 'about' ? 'filter-pill-active' : ''}`}
          >
            About Art Saturated
          </button>
        </div>

        {tab === 'artist' && <MeetTheArtist />}
        {tab === 'about'  && <AboutArtSaturated navigate={navigate} />}

      </div>
      <Footer />
    </main>
  )
}
