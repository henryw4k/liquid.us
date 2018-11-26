const { WWW_URL } = process.env
const Component = require('./Component')
const timeAgo = require('timeago.js')
const stateNames = require('datasets-us-states-abbr-names')

module.exports = class Comment extends Component {
  onclick(event) {
    if (~event.currentTarget.className.indexOf('privacy-indicator')) {
      event.preventDefault()
      this.setProps({ showPrivacyIndicator: true }).render(this.props)
    } else if (~event.currentTarget.className.indexOf('delete')) {
      this.setProps({ showPrivacyIndicator: false }).render(this.props)
    } else if (~event.currentTarget.className.indexOf('endorse')) {
      event.preventDefault()
      if (this.props.endorsed) {
        return this.unendorse()
      }
      return this.endorse()
    }
  }
  endorse() {
    const { measures = {}, reps = [], user } = this.state
    const { fullname, measure_id, short_id, id: vote_id } = this.props
    const measure = measures[short_id]
    const position = measure && measure.vote_position
    if (!user) {
      this.storage.set('endorsed_vote_id', vote_id)
      this.storage.set('endorsed_measure_id', measure_id)
      this.storage.set('endorsed_url', `/legislation/${short_id}/votes/${vote_id}`)
      return this.location.redirect('/join')
    }
    if (position) {
      if (!window.confirm(`You've already voted. Endorse ${fullname ? this.possessive(fullname) : 'this'} vote instead?`)) {
        return
      }
    }
    return this.api(`/endorsements?user_id=eq.${user.id}`, {
      method: 'POST',
      body: JSON.stringify({ user_id: user.id, vote_id, measure_id }),
    })
    .then(() => this.fetchMeasure(short_id))
    .then((measure) => {
      this.setState({
        measures: {
          ...measures,
          [short_id]: {
            ...measures[short_id],
            ...measure,
          }
        }
      })
      const repsInChamber = reps.filter(({ office_chamber }) => office_chamber === measure.chamber)
      const officeId = repsInChamber[0] && repsInChamber[0].office_id
      this.fetchConstituentVotes(measure, officeId)
    })
    .then(() => this.fetchTopComments(measure_id, short_id))
    .then(() => this.fetchComments(measure_id, short_id))
    .then(() => this.api(`/public_votes?id=eq.${vote_id}`))
    .then((votes) => {
      if (typeof window === 'object' && window._loq) window._loq.push(['tag', 'Voted'], ['tag', 'Endorsed'])
      this.setState({
        measures: {
          ...measures,
          [short_id]: {
            ...measures[short_id],
            comment: votes[0] || measures[short_id].comment,
          }
        },
        selected_profile: {
          ...this.state.selected_profile,
          public_votes: this.state.selected_profile.public_votes.map((vote) => {
            return vote.id === vote_id ? votes[0] : vote
          })
        },
      })
    })
    .catch((error) => console.log(error))
  }
  unendorse() {
    const { measures = {}, reps = [], user } = this.state
    if (!user) {
      return this.location.redirect('/join')
    }
    const { measure_id, short_id, id: vote_id } = this.props
    return this.api(`/endorsements?user_id=eq.${user.id}&vote_id=eq.${vote_id}`, {
      method: 'DELETE',
    })
    .then(() => this.fetchMeasure(short_id))
    .then((measure) => {
      this.setState({
        measures: {
          ...measures,
          [short_id]: {
            ...measures[short_id],
            ...measure,
          }
        }
      })
      const repsInChamber = reps.filter(({ office_chamber }) => office_chamber === measure.chamber)
      const officeId = repsInChamber[0] && repsInChamber[0].office_id
      return this.fetchConstituentVotes(measure, officeId)
    })
    .then(() => this.fetchTopComments(measure_id, short_id))
    .then(() => this.fetchComments(measure_id, short_id))
    .then(() => this.api(`/public_votes?id=eq.${vote_id}`))
    .then((votes) => {
      this.setState({
        measures: {
          ...measures,
          [short_id]: {
            ...measures[short_id],
            comment: votes[0] || measures[short_id].comment,
          }
        },
        selected_profile: {
          ...this.state.selected_profile,
          public_votes: this.state.selected_profile.public_votes.map((vote) => {
            return vote.id === vote_id ? votes[0] : vote
          })
        },
      })
    })
    .catch((error) => console.log(error))
  }
  fetchMeasure(short_id) {
    const type = ~short_id.indexOf('-pn') ? '&type=eq.PN' : '&or=(type.eq.HR,type.eq.S,type.eq.AB,type.eq.SB)'
    const url = `/measures_detailed?short_id=eq.${short_id}${type}`

    return this.api(url).then((results) => results[0])
  }
  fetchConstituentVotes(measure, office_id) {
    const { id, short_id } = measure
    const officeParam = office_id && measure.legislature_name === 'U.S. Congress' ? `&office_id=eq.${office_id}` : '&limit=1'
    return this.api(`/measure_votes?measure_id=eq.${id}${officeParam}`).then((results) => {
      const votes = results[0] || {}
      const measures = this.state.measures || {}
      this.setState({
        measures: {
          ...measures,
          [short_id]: {
            ...measures[short_id],
            ...votes
          },
        },
      })
    })
  }
  fetchTopComments(id, short_id) {
    const order = `order=proxy_vote_count.desc.nullslast,created_at.desc`
    return this.api(`/public_votes?measure_id=eq.${id}&comment=not.is.null&comment=not.eq.&position=eq.yea&${order}`).then((comments) => {
      const yea = comments[0]

      return this.api(`/public_votes?measure_id=eq.${id}&comment=not.is.null&comment=not.eq.&position=eq.nay&${order}`).then((comments) => {
        const nay = comments[0]
        this.setState({
          measures: {
            ...this.state.measures,
            [short_id]: {
              ...this.state.measures[short_id],
              top_yea: yea,
              top_nay: nay,
            },
          },
        })
      })
    })
  }
  fetchComments(measure_id, short_id) {
    const { query } = this.location
    const order = query.order || 'most_recent'
    const position = query.position || 'all'
    const orders = {
      most_recent: 'updated_at.desc',
      vote_power: 'proxy_vote_count.desc.nullslast,created_at.desc',
    }
    const positions = {
      all: '',
      yea: '&position=eq.yea',
      nay: '&position=eq.nay',
    }
    return this.api(`/public_votes?measure_id=eq.${measure_id}&comment=not.is.null&comment=not.eq.&order=${orders[order]}${positions[position]}`).then((comments) => {
      this.setState({
        measures: {
          ...this.state.measures,
          [short_id]: {
            ...this.state.measures[short_id],
            comments,
          },
        },
      })
    })
  }
  render() {
    const { comment, author_username, endorsed, updated_at, fullname, id, number, proxy_vote_count, position, show_bill, short_id, title, type, username, user_id, public: is_public, truncated, twitter_username, showPrivacyIndicator, source_url } = this.props
    const { measures, selected_profile, user } = this.state
    const measure = measures && measures[short_id]
    const avatarURL = this.avatarURL(this.props)
    const measure_url = `${author_username ? `/${author_username}/` : '/'}${type === 'PN' ? 'nominations' : 'legislation'}/${short_id}`
    const comment_url = `${measure_url}/votes/${id}`
    const share_url = `${WWW_URL}${comment_url}`
    const subject = fullname ? `${fullname} is` : 'People are'
    const measure_title = type && number ? `${type} ${number} — ${title}` : title
    const anonymousName = measure
      ? `${measure.legislature_name === 'U.S. Congress' ? 'American' : (stateNames[measure.legislature_name] || measure.legislature_name)} Resident`
      : 'Anonymous'
    const twitter_measure_title = type && number ? `${type} ${number}` : title
    const twitter_share_text = `${user && user.id === user_id ? `I'm` : subject} voting ${position === 'yea' ? 'in favor' : 'against'} ${twitter_measure_title}. See why: ${share_url}`
    const tooltip = is_public || !fullname
      ? `This vote is public. Anyone can see it.`
      : user && user.id === user_id
        ? `This is your vote. Only <a href="/proxies/requests">people you've approved</a> will see your identity.`
        : `${fullname} granted you permission to see this vote. Don’t share it publicly.`
    const onBehalfOfCount = username && !twitter_username ? (proxy_vote_count + 1) : proxy_vote_count

    return this.html`
      <div onclick=${this} class="comment">
        <style>
          .comment:not(:last-child) {
            margin-bottom: 1.5rem;
          }
        </style>
        <div class="media">
          ${show_bill && selected_profile
          ? ''
          : [`
              <div class="media-left">
                <div class="image is-32x32">
                  ${username || twitter_username
                    ? `<a href="/${twitter_username ? `twitter/${twitter_username}` : username}">
                        <img src="${avatarURL}" alt="avatar" class="round-avatar-img" />
                      </a>`
                    : `<img src="${avatarURL}" alt="avatar" class="round-avatar-img" />`}
                </div>
              </div>
          `]}
          <div class="media-content" style="${`${show_bill ? '' : `border-left: 1px solid ${position === 'yea' ? 'hsl(141, 71%, 87%)' : 'hsl(348, 100%, 93%)'}; margin-left: -2rem; padding-left: 2rem;`}`}">
            ${[show_bill && selected_profile ? `
              <div>
                <span class="has-text-weight-semibold">${username || twitter_username ? fullname : anonymousName}</span>
                <span>voted <strong>${position}</strong>${onBehalfOfCount ? ` on behalf of <span class="has-text-weight-semibold">${onBehalfOfCount}</span> ${onBehalfOfCount === 1 ? 'person' : 'people'}` : ''}</span>
                ${source_url ? [`<span class="is-size-7"> via <a href="${source_url}" target="_blank">${source_url.split('/')[2] || source_url}</a></span>`] : ''}
              </div>
              <div style="margin-bottom: .5rem;"><a href="${measure_url}">${measure_title}</a></div>
            ` : `
              <div>
                <span class="has-text-weight-semibold">
                  ${username || twitter_username
                    ? [`<a href="/${twitter_username ? `twitter/${twitter_username}` : username}">${fullname}</a>`]
                    : anonymousName}
                </span>
                <span>voted <strong style="color: ${position === 'yea' ? 'hsl(141, 80%, 38%)' : (position === 'abstain' ? 'default' : 'hsl(348, 80%, 51%)')};">${position}</strong>${onBehalfOfCount ? ` on behalf of <span class="has-text-weight-semibold">${onBehalfOfCount}</span> ${onBehalfOfCount === 1 ? 'person' : 'people'}` : ''}</span>
                ${source_url ? [`<span class="is-size-7"> via <a href="${source_url}" target="_blank">${source_url.split('/')[2] || source_url}</a></span>`] : ''}
              </div>
            `]}
            ${comment ? CommentContent.for(this, { comment, truncated }, `comment-context-${id}`) : ''}
            <div class="${`notification is-size-7 has-text-centered comment-tooltip ${showPrivacyIndicator ? '' : 'is-hidden'}`}"><button onclick=${this} class="delete"></button>${[tooltip]}</div>
            <div class="is-size-7" style="position: relative; line-height: 25px; margin-top: 0.2rem;">
              <a class="has-text-grey-light" title="Permalink" href="${share_url}">${timeAgo().format(`${updated_at}Z`)}</a>
              <span class="has-text-grey-light">
                ${user && user.id === user_id ? [`
                  <span class="has-text-grey-lighter">&bullet;</span>
                  <a href="${`${measure_url}?action=add-argument`}" class="has-text-grey-light">
                    <span class="icon is-small"><i class="fas fa-pencil-alt"></i></span>
                    <span>Edit</span>
                  </a>
                `] : ''}
                <span class="${`has-text-grey-lighter ${!is_public && fullname ? '' : 'is-hidden'}`}">&bullet;</span>
                <a href="#" onclick=${this} class="${`has-text-grey-light privacy-indicator ${!is_public && fullname ? '' : 'is-hidden'}`}">
                  <span class="icon is-small"><i class="${`${is_public || !fullname ? 'fa fa-globe-americas' : 'far fa-address-book'}`}"></i></span>
                  <span>${is_public || !fullname ? 'Public' : 'Private'}</span>
                </a>
                ${is_public || !fullname ? [`
                  <span class="has-text-grey-lighter">&bullet;</span>
                  <a title="Share on Facebook" target="_blank" href="${`https://www.facebook.com/sharer/sharer.php?u=${share_url}`}" class="has-text-grey-light"><span class="icon is-small"><i class="fab fa-facebook"></i></span></a>
                  <a target="_blank" title="Share on Twitter" href="${`https://twitter.com/intent/tweet?text=${twitter_share_text}`}" class="has-text-grey-light"><span class="icon is-small"><i class="fab fa-twitter"></i></span></a>
                  <a target="_blank" title="Permalink" href="${share_url}" class="has-text-grey-light"><span class="icon is-small"><i class="fa fa-link"></i></span></a>
                `] : ''}
                <span class="has-text-grey-lighter">&bullet;&nbsp;</span>
                <a href="#" onclick=${this} class="${`has-text-weight-semibold has-text-grey endorse button is-small ${endorsed ? 'is-light' : ''}`}">
                  <span>${endorsed ? 'Endorsed' : 'Endorse'}</span>
                </a>
                <style>
                  .comment .endorse.is-light {
                    border-color: #cecece;
                  }
                </style>
              </span>
            </div>
          </div>
        </div>
      </div>
    `
  }
}

class CommentContent extends Component {
  onclick(event) {
    event.preventDefault()
    this.setProps({ expanded: !this.props.expanded }).render(this.props)
  }
  breakOnWord(str) {
    const truncated = str.slice(0, 300).replace(/ \w+$/, '')
    if (str.length > truncated.length) {
      return `${truncated}...`
    }
    return truncated
  }
  render({ comment = '', expanded = false, truncated = false }) {
    const showExpander = truncated && comment.length > 300
    return this.html`
      <div class="content" style="margin: .25rem 0 .75rem;">
        ${[this.linkifyUrls(expanded || !truncated ? comment : this.breakOnWord(comment))]}
        <span class="${showExpander ? '' : 'is-hidden'}">
          <a href="#" onclick=${this} class="is-size-7">
            <span>show ${expanded ? 'less' : 'more'}</span>
          </a>
        </span>
      </div>
    `
  }
}
