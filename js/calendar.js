/*
* MDAT Calendar component
*
* Copyright (c) 2015 MIT Hyperstudio
* Christopher York, 04/2015
*
*/

require('../css/calendar.css')

const hg = require('mercury')
const h = require('mercury').h

const d3 = require('d3')
const colorbrewer = require('colorbrewer')
const d3_time = require('d3-time')  // until d3 core updated to use d3-time 0.0.5
const queue = require('queue-async')

import { easter, easterForYear, easterCeiling } from './util/date-utils'
const i18n = require('./util/i18n')

const datapoint = require('./util/datapoint')

const assign = require('object-assign')

const cellSize = 8
const timeFormat = d3.time.format
const numberFormat = d3.format

const day = d3.time.format('%w')

// number of sundays since the prior March 1
const weeksOffset = (e, y) => d3_time.sunday.count(d3_time.sunday(new Date(e.getFullYear(), 3, 1)), y)
const invertWeekOffset = (y, c) => d3_time.sunday.offset(d3_time.sunday(new Date(y.getFullYear(), 3, 1)), c)

const margins = { top: 30, right: 5, bottom: 10, left: 25 }

const dateIndexFormat = d3.time.format('%Y-%m-%d')


var y_global = null

var sameDate = function(d0, d1) {
  return d0 && d1 && (d1 - d0 === 0)
}

var yearRange = function(i0, i1) {
  var yearFormat = d3.format("04d")
  var [ s0, s1 ] = [ yearFormat(i0), yearFormat(i1) ]
  var i = 3
  while (i >= 0 && s0[i] !== s1[i]) {
    i--
  }

  return s0 + "-" + s1.slice(i+1)
}


function GraphWidget(calendar_data, theater_data, calendar_extent, sel_dates, focus_day, mode, lang) {
  this.calendar_data = calendar_data
  this.theater_data = theater_data
  this.calendar_extent = calendar_extent
  this.sel_dates = sel_dates
  this.focus_day = focus_day
  this.mode = mode
  this.lang = lang
}

GraphWidget.prototype.type = 'Widget'

GraphWidget.prototype.init = function() {
  var elem = document.createElement('div')

  var graph = d3.select(elem)
      .classed('graph', true)
  var canvas = graph.append('canvas')
      .attr('width', 550)
  var svg = graph.append('svg')
    .attr('width', 550)
  svg.append('g')
    .classed('foreground', true)

  this.listen(elem)

  return elem
}

GraphWidget.prototype.select = function() {
  var date = pointToDate(d3.event, this.calendar_extent)
  this.props.handlePreview(date)
}

function pointToDate(e, extent) {
  var canvas = d3.select(".calendar canvas")[0][0]
  var rect = canvas.getBoundingClientRect()
  var x = e.clientX - rect.left
  var y = e.clientY - rect.top

  if (y < margins.top) { return null }

  var date_min = dateIndexFormat.parse(extent[0])
  var season_min = easter(date_min)

  var seasonOffset = Math.floor( (y - margins.top) / (cellSize * 9) )
  var weekOffset = Math.floor( (x - margins.left) / cellSize )
  var weekdayOffset = Math.floor( (y - margins.top) / cellSize % 9 )

  if(weekdayOffset > 6) { return null }

  var season = easterForYear( season_min.getFullYear() + seasonOffset)
  var week = invertWeekOffset(season, weekOffset)
  var date = d3_time.day.offset(week, weekdayOffset)

  return date
}

GraphWidget.prototype.listen = function(elem) {
  // TODO.  not clear why this is needed...  check virtual-dom update cycle
  if(this.calendar_extent && this.calendar_extent[0] && this.calendar_extent[1]) {
    var boundhover = hover.bind(this)
    var svg = d3.select(elem)
      .select('svg')
    svg.on("mousemove", boundhover)
     .on("mouseleave", boundhover)
  }

  function hover() {
    var svg = d3.select(elem)
      .select('svg')

    var locale = i18n[this.lang]
    var tooltipFormat = locale.timeFormat("%a %e %b %Y")

    var season = (date) => easter(date)
    var date = pointToDate(d3.event, this.calendar_extent)

    var tooltip = svg.select(".foreground").selectAll(".tooltip")
      .data((date && y_global) ? [ date ] : [])
    tooltip.exit().remove()
    tooltip.enter().append("text")
      .classed("tooltip", true)
      .attr("text-align", "left")

    tooltip.attr("x", (date) => weeksOffset(season(date), d3.time.month(date)) * cellSize)
      .attr("y", (date) => y_global(season(date)) + 8.2 * cellSize)
      .text(tooltipFormat)
  }
}

GraphWidget.prototype.update = function(prev, elem) {
  this.calendar_data = this.calendar_data || prev.calendar_data
  this.calendar_extent = this.calendar_extent || prev.calendar_extent

  this.listen(elem)

  var graph = d3.select(elem)
  var canvas = graph.select("canvas")[0][0]
  var locale = i18n[this.lang]
  var xAxisFormat = (d) => locale.timeFormat('%b')(d).toLowerCase()

  var data = this.calendar_data
  var keys = d3.keys(data)

  if(keys.length === 0) { return }

  var [ lo, hi ] = this.calendar_extent.map(dateIndexFormat.parse)
  var data_extent = [ easter(lo), easterCeiling(hi) ]
  var height = (data_extent[1].getFullYear() - data_extent[0].getFullYear()) * cellSize * 9

  canvas.height = margins.top + margins.bottom + height
  var svg = d3.select(elem)
    .select("svg")
      .attr("height", canvas.height)
//    canvas.width = margins.left + margins.right + width

  var y = d3.scale.linear()
    .domain(data_extent)
    .range([0, height])

  // TODO.  bad, very bad -- replace with a more sustainable solution
  y_global = y

  var dayColorScale = d3.scale.quantile()
    .domain( d3.values(this.calendar_data) )

  var dayColor = (d, blur) => {
    var bisect = d3.bisector( (d) => d.day ).right;

    var s = dateIndexFormat(d)
    var d = this.calendar_data[s]

    if (!d) { return "white" }

    if (blur) {
      return dayColorScale
        .range(colorbrewer.Greys[9].slice(0,7))(d)
    } else {
      return dayColorScale
        .range(colorbrewer.YlGnBu[9].slice(0,7))(d)
    }
  }

  var ctx = canvas.getContext('2d')
  ctx.save()
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  ctx.translate(0.5,0.5);

  var seasons = d3.range(data_extent[0].getFullYear(), data_extent[1].getFullYear()).map(easterForYear)

  seasons.forEach( (season) => {
    ctx.save()
    ctx.translate(margins.left, margins.top + y(season))

    var x = (date) => weeksOffset(season, date) * cellSize

    var nextSeason = easterForYear(season.getFullYear()+1)
    var days = d3.time.days( season, nextSeason )

    if (this.mode === 'focus') {

      days.forEach( (d) => {
        var rx = Math.round( x(d) )
        var ry = Math.round( +day(d) * cellSize )

        ctx.strokeStyle = '#ccc'
        ctx.strokeRect(rx, ry, cellSize, cellSize)

        var se = this.sel_dates
        var sel = !se || (se[0] < d && d < se[1])

        ctx.fillStyle = dayColor(d, false)//!sel)
        ctx.fillRect(rx, ry, cellSize, cellSize)
      })

      var months = d3.time.months( new Date(season.getFullYear(), 3, 1), new Date(nextSeason.getFullYear(), 4, 1) )

      months.forEach( (t0) => {
        ctx.strokeStyle = 'black'

        var t1 = new Date(t0.getFullYear(), t0.getMonth() + 1, 0),
            d0 = +day(t0), w0 = +weeksOffset(season, t0),
            d1 = +day(t1), w1 = +weeksOffset(season, t1)

        var path = new Path2D()
        path.moveTo( (w0 + 1) * cellSize, d0 * cellSize )
        path.lineTo( w0 * cellSize, d0 * cellSize )
        path.lineTo( w0 * cellSize, 7 * cellSize )
        path.lineTo( w1 * cellSize, 7 * cellSize )
        path.lineTo( w1 * cellSize, (d1 + 1) * cellSize )
        path.lineTo( (w1 + 1) * cellSize, (d1 + 1) * cellSize )
        path.lineTo( (w1 + 1) * cellSize, 0 )
        path.lineTo( (w0 + 1) * cellSize, 0 )
        path.lineTo( (w0 + 1) * cellSize, d0 * cellSize )

        ctx.stroke(path);
      })

    } else if (this.state.mode === 'context') {
      console.log("drawing context")
    } else {

      throw "Unkown mode " + mode;
    }

    // y axis

    var y_label = yearRange(season.getFullYear(), season.getFullYear()+1)
    ctx.translate(margins.left - 36, Math.round( cellSize * 7 / 2.0) )
    ctx.rotate(-Math.PI/2.0)
    ctx.fillStyle = "black"
    ctx.textBaseline="bottom";
    ctx.textAlign = "center"
    ctx.fillText(y_label, 0, 0)

    ctx.restore()
  })

  // selected date

  d3.select(".calendar svg")
    .select(".foreground")
    .attr("transform", "translate(" + margins.left + "," + margins.top + ")")

    var circle = d3.select(".calendar svg")
        .selectAll("circle")
      .data(this.focus_day ? [this.focus_day] : [])

    circle.exit().remove()
    circle.enter()
      .append('circle')
      .attr("r", 5)
      .attr("stroke", "red")
      .attr("stroke-width", 1.5)
      .attr("fill", "none")

    circle
      .attr("cx", (d) => Math.round( margins.left + weeksOffset(easter(d), d) * cellSize + 4) )
      .attr("cy", (d) => Math.round( margins.top + y(easter(d)) + +day(d) * cellSize + 4) )

  // periods

  ctx.translate(margins.left + 59 * cellSize, margins.top)
  ctx.strokeStyle = 'black'

  d3.keys(this.theater_data).forEach( (name) => {
    ctx.save()
    var theater = this.theater_data[name]
    var start_season = easter(theater.start_date)
    var end_season = easterCeiling(theater.end_date)
    var path = new Path2D()
    var yStart = Math.round( y(start_season) )
    path.lineWidth = 1
    path.moveTo(0, yStart)
    path.lineTo(cellSize * 2, yStart)
    path.moveTo(cellSize, yStart)
    path.lineTo(cellSize, Math.round(y(end_season) - cellSize * 3))
    path.lineTo(0, Math.round(y(end_season) - cellSize * 2))
    ctx.stroke(path)

    ctx.textAlign = "left"
    ctx.translate(cellSize * 2, y(start_season) + cellSize)
    ctx.rotate(Math.PI / 2.0)
    ctx.fillText(name, 0, 0)
    ctx.restore()
  })

  ctx.restore()

  // axes

  var months = d3.time.months( new Date(seasons[0].getFullYear(), 3, 1),
                               new Date(seasons[0].getFullYear()+1, 4, 1) )

  ctx.save()
  ctx.translate(margins.left, margins.top)
  ctx.fillStyle = "black"
  ctx.textAlign = "left"
  months.forEach( (d) => {
    ctx.fillText(xAxisFormat(d), +weeksOffset(seasons[0], d) * cellSize + cellSize * 2, -9)
  })
  ctx.restore()

  ctx.restore()
}

function Calendar() {
  return null
}

Calendar.render = function(state, lang) {
  var sendDay = hg.BaseEvent(function(ev, broadcast) {
    var date = pointToDate(ev, state.calendar_extent)
    console.log(date)
    broadcast(assign(this.data, { date: date }))
  })

  return (
    h('div.calendar', {
      'ev-click' : sendDay(state.channels.focus_day)
    }, [
      new GraphWidget(state.calendar_data, state.theater_data, state.calendar_extent, state.sel_dates, state.focus_day, 'focus', lang)
    ])
  )
}

export default Calendar

/*
var d3_time_format = require('d3-time-format')

const format = d3_time_format.format("%Y-%m-%d")

function Calendar() {
  return null
}

Calendar.render = function(state) {
  return h('div.calendar', [
            h('div.sel_dates', [
              "Selected dates: " + state.sel_dates.map(format).join(' to '),
              h('button', {
                'ev-click': hg.send(state.channels.sel_dates, random_dates(format.parse('1692-03-22'), format.parse('1782-02-11'), 2))
                }, [ "foobar!" ])
             ]),
            h('div.graph', state.calendar_data.map(square)),
            h('div.periods', state.theater_data.map(period)),
            h('div.day', [ "Current focused day: " + state.focus_day ])
         ])
  function square(x) {
    return h('span.date', {
               'ev-click': hg.send(state.channels.focus_day, x.day)
             }, [ String(x.day + " : " + x.sum_receipts) + ", " ])
  }
  function period(x) {
    return h('div.period', {
      'ev-click': hg.send(state.channels.focus_theater, x.theater_period)
    }, [ String(x.theater_period) + " : " + x['min(date)'] ] )
  }
}

function random_dates(start, end, count) {
  var dates = []
  for(var i=0; i<count; i++) {
    dates[i] = new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime()))
  }
  dates.sort()
  return dates
}*/